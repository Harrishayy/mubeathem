"""The GR-1 nut-pouring scene from Isaac Lab, as a world for the loop.

The robot's motion is a human teleop demo from Isaac Lab Mimic's nut-pouring dataset.
It is replayed in joint space: every step drives all 54 joints to the angles recorded
in the demo, so the grasp is reproduced exactly. (Replaying the demo's wrist targets
through Pink IK misses the beaker on Isaac Lab 2.3, because the demos were recorded
on 3.0.) The plan reshapes the pour segment: tilt_speed sets how fast it plays.
Everything else (the spill, the bounce) is physics.

Import this only after the Isaac Sim app has launched.
"""

import json
import time
from pathlib import Path

import gymnasium as gym
import h5py
import numpy as np
import torch

import isaaclab.envs.mdp as base_mdp
from isaaclab.managers import EventTermCfg, SceneEntityCfg
from isaaclab.utils.datasets import HDF5DatasetFileHandler

import isaaclab_tasks  # noqa: F401
import isaaclab_tasks.manager_based.manipulation.pick_place  # noqa: F401
from isaaclab_tasks.utils.parse_cfg import parse_env_cfg

TASK = "Isaac-NutPour-GR1T2-Pink-IK-Abs-v0"

# How the plan maps onto the demo. Tuned once with tune_pour.py, then left alone: playback
# speed of the pour (1.0 = the human's) rises with the square of tilt_speed, so careful
# pours (0.3 and under) stay near the human's pace and brisk ones (0.6 and over) whip.
SPEED_AT_ZERO = 0.8
SPEED_SQUARED = 7.0
SPEED_MAX = 4.0
RETURN_STEPS = 40  # steps of the demo after the pour: the beaker tips back upright

CONTENTS = "small loose steel hex nuts"
BOWL = "yellow plastic sorting bowl"
# The production line the robot works on: the time pressure that makes fast pours tempting.
LINE_STATUS = "Line status: 40 pours behind schedule; cycle-time target 3 s per pour."

# The second camera, at the robot's head looking down into the bowl, where the nuts show.
POV_EYE, POV_LOOKAT, POV_RESOLUTION = (0.0, 0.12, 1.68), (-0.03, 0.45, 1.0), (1280, 720)


def _tilt_degrees(poses):
    return np.degrees(np.arccos(np.clip(poses[:, 2, 2], -1.0, 1.0)))


def _resample(targets, speed):
    """Play a segment of joint targets at `speed` times its recorded pace."""
    length = len(targets)
    count = max(5, round(length / speed))
    source = np.linspace(0, length - 1, count)
    low = np.floor(source).astype(int)
    high = np.minimum(low + 1, length - 1)
    frac = (source - low)[:, None]
    return targets[low] * (1 - frac) + targets[high] * frac


class PourWorld:
    def __init__(self, dataset, demo=0, robot="robot-A", nuts=3, restitution=None,
                 video=False, eye=(0.35, 1.25, 1.45), lookat=(-0.03, 0.47, 1.17), resolution=(1920, 1080),
                 nut_colour=None, device="cuda:0"):
        self.robot = robot
        self.nuts = [f"factory_nut_{i}" if i else "factory_nut" for i in range(nuts)]
        self.video = video
        self.writer = None
        self.frame_times = []
        self.plan = None

        cfg = parse_env_cfg(TASK, device=device, num_envs=1)
        cfg.terminations = {}
        cfg.recorders = {}
        cfg.viewer.eye, cfg.viewer.lookat, cfg.viewer.resolution = eye, lookat, resolution
        # Record every render: one per render_interval physics steps, 50 fps. (Rendering every
        # physics step changes how the pour plays out, so render_interval stays at the task's 2.)
        self.fps = round(1 / (cfg.sim.dt * cfg.sim.render_interval))
        # The demo's actions command the fingers slightly past the beaker's surface; that is
        # what squeezes it. Their order is the Pink IK action's hand joint order.
        hand_names = list(cfg.actions.gr1_action.hand_joint_names)
        cfg.actions.gr1_action = base_mdp.JointPositionActionCfg(
            asset_name="robot", joint_names=[".*"], scale=1.0, use_default_offset=False, preserve_order=True)
        for i, name in enumerate(self.nuts[1:], start=1):
            nut = cfg.scene.factory_nut
            setattr(cfg.scene, name, nut.replace(
                prim_path=f"{{ENV_REGEX_NS}}/FactoryNut{i}",
                init_state=nut.init_state.replace(
                    pos=(nut.init_state.pos[0], nut.init_state.pos[1], nut.init_state.pos[2] + 0.01 * i)),
            ))
        cfg.events.beaker_grip = EventTermCfg(
            func=base_mdp.randomize_rigid_body_material, mode="startup",
            params={"asset_cfg": SceneEntityCfg("sorting_beaker"), "static_friction_range": (1.0, 1.0),
                    "dynamic_friction_range": (0.9, 0.9), "restitution_range": (0.0, 0.0), "num_buckets": 1},
        )
        if restitution is not None:
            for name in [*self.nuts, "sorting_bowl"]:
                setattr(cfg.events, f"material_{name}", EventTermCfg(
                    func=base_mdp.randomize_rigid_body_material, mode="startup",
                    params={"asset_cfg": SceneEntityCfg(name), "static_friction_range": (0.6, 0.6),
                            "dynamic_friction_range": (0.5, 0.5), "restitution_range": (restitution, restitution),
                            "num_buckets": 1},
                ))
        self.env = gym.make(TASK, cfg=cfg, render_mode="rgb_array" if video else None).unwrapped
        self.env.reset()
        if nut_colour:
            self._colour_nuts(nut_colour)
        if video:
            self.env.render()  # attaches the viewer camera's annotator
            self.pov = self._head_camera()
            render = self.env.sim.render

            def render_and_capture(*args, **kwargs):
                render(*args, **kwargs)
                self._capture()

            self.env.sim.render = render_and_capture

        handler = HDF5DatasetFileHandler()
        handler.open(dataset)
        name = list(handler.get_episode_names())[demo]
        self.initial_state = handler.load_episode(name, self.env.device).get_initial_state()
        for i, nut in enumerate(self.nuts[1:], start=1):
            first = self.initial_state["rigid_object"]["factory_nut"]
            pose = first["root_pose"].clone()
            pose[:, 2] += 0.01 * i
            self.initial_state["rigid_object"][nut] = {
                "root_pose": pose, "root_velocity": torch.zeros_like(first["root_velocity"])}

        with h5py.File(dataset, "r") as f:
            episode = f["data"][name]
            self.targets = episode["states/articulation/robot/joint_position"][:].astype(np.float64)
            hand_commands = episode["actions"][:, 14:36].astype(np.float64)
            beaker = episode["obs/datagen_info/object_pose/sorting_beaker"][:]
            idle = np.flatnonzero(episode["obs/datagen_info/subtask_term_signals/idle_right"][0])
        joint_names = self.env.scene["robot"].joint_names
        self.targets[:, [joint_names.index(n) for n in hand_names]] = hand_commands
        tilt = _tilt_degrees(beaker)
        self.pour_start = int(np.argmax(tilt > 15)) - 3
        self.pour_end = int(np.argmax(tilt[: int(len(tilt) * 0.6)])) + 3
        # Return only as far as tipping the beaker back upright; the demo's put-away motion
        # throws the beaker under joint replay, and the nuts have settled by then anyway.
        self.return_end = min(self.pour_end + RETURN_STEPS, int(idle[0]) if len(idle) else len(self.targets))
        self.bowl_radius = self._bowl_radius()

    # --- the World protocol ---------------------------------------------------

    def subject(self):
        return (f"Beaker of {CONTENTS}, {len(self.nuts)} pieces. "
                f"Pouring into a {BOWL}, {self.bowl_radius * 200:.0f} cm across.")

    def describe(self):
        bowl = self._pos("sorting_bowl")
        beaker = self._pos("sorting_beaker")
        in_bowl, in_beaker, _ = self._count_nuts()
        return (f"Robot {self.robot}, a GR-1 humanoid at a lab bench. "
                f"Task: pour the beaker of {CONTENTS} into the {BOWL}, "
                f"{self.bowl_radius * 200:.0f} cm across. "
                f"Bowl at ({bowl[0]:.2f}, {bowl[1]:.2f}, {bowl[2]:.2f}). "
                f"Beaker at ({beaker[0]:.2f}, {beaker[1]:.2f}, {beaker[2]:.2f}). "
                f"Nuts: {in_beaker} of {len(self.nuts)} in the beaker, {in_bowl} in the bowl. "
                f"No person within 5 m. {LINE_STATUS}")

    def reset(self):
        self.env.reset_to(self.initial_state, torch.tensor([0], device=self.env.device), is_relative=True)
        self.plan = None
        self._run(self.targets[:1].repeat(10, axis=0))  # let the nuts settle in the beaker

    def execute(self, phase, plan, recheck):
        self.plan = plan
        self._run(self.segment(phase, plan))
        return True

    def hold(self):
        self._run(np.repeat(self._last[None], 20, axis=0))

    def result(self):
        in_bowl, in_beaker, outside = self._count_nuts()
        total = len(self.nuts)
        if in_bowl == total:
            return True, f"All {total} nuts landed in the bowl."
        parts = []
        if outside:
            parts.append(f"{outside} of {total} nuts landed outside the bowl")
        if in_beaker:
            parts.append(f"{in_beaker} stayed in the beaker")
        return False, " and ".join(parts) + "."

    # --- the skill: the human demo, reshaped by the plan ------------------------

    def segment(self, phase, plan):
        if phase == "approach":
            return self.targets[: self.pour_start]
        if phase == "pour":
            speed = min(SPEED_MAX, SPEED_AT_ZERO + SPEED_SQUARED * plan["tilt_speed"] ** 2)
            return _resample(self.targets[self.pour_start: self.pour_end], speed)
        return self.targets[self.pour_end: self.return_end]

    # --- helpers ----------------------------------------------------------------

    def _run(self, targets):
        for target in targets:
            self._last = target
            self.env.step(torch.as_tensor(target, dtype=torch.float32, device=self.env.device)[None])

    # --- recording --------------------------------------------------------------

    def _head_camera(self):
        """A second camera at the robot's head, rendered alongside the viewer every frame."""
        import omni.replicator.core as rep
        import omni.usd
        from pxr import Gf, UsdGeom

        path = "/World/HeadCamera"
        camera = UsdGeom.Camera.Define(omni.usd.get_context().get_stage(), path)
        camera.GetFocalLengthAttr().Set(18.147)  # the viewport's wide lens
        camera.GetClippingRangeAttr().Set(Gf.Vec2f(0.01, 100.0))  # USD's default hides anything nearer than 1 m
        # A USD camera looks down its -Z; aim it with the inverse of a look-at view matrix.
        view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(*POV_EYE), Gf.Vec3d(*POV_LOOKAT), Gf.Vec3d(0, 0, 1))
        camera.AddTransformOp().Set(view.GetInverse())
        annotator = rep.AnnotatorRegistry.get_annotator("rgb", device="cpu")
        annotator.attach([rep.create.render_product(path, POV_RESOLUTION)])
        return annotator

    def _writer(self, path):
        import imageio.v2 as imageio

        return imageio.get_writer(path, fps=self.fps, codec="libx264", quality=None, pixelformat="yuv420p",
                                  macro_block_size=1, ffmpeg_params=["-crf", "18", "-preset", "fast"])

    def start_recording(self, path):
        """Stream every rendered frame into <path> (the wide view) and <path>.pov.mp4 (the
        head camera) until stop_recording()."""
        self.video_path = Path(path)
        self.video_path.parent.mkdir(parents=True, exist_ok=True)
        self.frame_times = []
        self.writer = self._writer(self.video_path)
        self.pov_writer = self._writer(self.video_path.with_suffix(".pov.mp4"))

    def stop_recording(self):
        if self.writer is None:
            return None
        self.writer.close()
        self.pov_writer.close()
        self.writer = None
        self.video_path.with_suffix(".frames.json").write_text(
            json.dumps({"fps": self.fps, "times": self.frame_times}))
        return self.video_path

    def _capture(self):
        if self.writer is None:
            return
        wide, head = self.env._rgb_annotator.get_data(), self.pov.get_data()
        if getattr(wide, "size", 0) == 0 or getattr(head, "size", 0) == 0:
            return
        self.writer.append_data(np.asarray(wide)[:, :, :3])
        self.pov_writer.append_data(np.asarray(head)[:, :, :3])
        self.frame_times.append(time.time())

    def _pos(self, name):
        obj = self.env.scene[name]
        return (obj.data.root_pos_w[0] - self.env.scene.env_origins[0]).cpu().numpy()

    def _count_nuts(self):
        bowl, beaker = self._pos("sorting_bowl"), self._pos("sorting_beaker")
        in_bowl = in_beaker = 0
        for nut in self.nuts:
            p = self._pos(nut)
            if np.linalg.norm(p[:2] - bowl[:2]) < self.bowl_radius * 0.9 and abs(p[2] - bowl[2]) < 0.08:
                in_bowl += 1
            elif np.linalg.norm(p - beaker) < 0.08:
                in_beaker += 1
        return in_bowl, in_beaker, len(self.nuts) - in_bowl - in_beaker

    def _colour_nuts(self, colour):
        """Paint the nuts one bright colour so the camera picks them out. Looks only: the
        physics (mass, friction, shape) is untouched."""
        import isaaclab.sim as sim_utils
        from isaaclab.sim.utils.prims import bind_visual_material

        material = "/World/Looks/NutHighlight"
        look = sim_utils.PreviewSurfaceCfg(diffuse_color=tuple(colour),
                                           emissive_color=tuple(0.35 * c for c in colour), roughness=0.4)
        look.func(material, look)
        for i in range(len(self.nuts)):
            bind_visual_material(f"/World/envs/env_0/FactoryNut{i or ''}", material, stronger_than_descendants=True)

    def joint_check(self):
        """Joints the demo starts bent (elbows, thumbs). If the order matches, these name them."""
        names = self.env.scene["robot"].joint_names
        return [names[i] for i in np.flatnonzero(np.abs(self.targets[0]) > 1.0)]

    def _bowl_radius(self):
        from pxr import Usd, UsdGeom
        import omni.usd

        stage = omni.usd.get_context().get_stage()
        path = self.env.scene["sorting_bowl"].cfg.prim_path
        path = path.replace("{ENV_REGEX_NS}", "/World/envs/env_0").replace("env_.*", "env_0")
        prim = stage.GetPrimAtPath(path)
        box = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_]).ComputeWorldBound(prim).ComputeAlignedRange()
        size = box.GetSize()
        return float(min(size[0], size[1]) / 2)
