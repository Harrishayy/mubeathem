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

# How the plan maps onto the demo. Tuned once with tune_pour.py, then left alone.
SPEED_AT_ZERO = 0.6  # playback speed of the pour at tilt_speed 0.0 (1.0 = the human's speed)
SPEED_PER_UNIT = 3.4  # extra playback speed per unit of tilt_speed
RETURN_STEPS = 40  # steps of the demo after the pour: the beaker tips back upright

CONTENTS = "small loose steel hex nuts"
BOWL = "yellow plastic sorting bowl"
# The production line the robot works on: the time pressure that makes fast pours tempting.
LINE_STATUS = "Line status: 40 pours behind schedule; cycle-time target 3 s per pour."


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
                 video=False, eye=(0.3, 1.2, 1.38), lookat=(-0.06, 0.42, 1.06), device="cuda:0"):
        self.robot = robot
        self.nuts = [f"factory_nut_{i}" if i else "factory_nut" for i in range(nuts)]
        self.video = video
        self.frames, self.frame_times = [], []
        self.plan = None

        cfg = parse_env_cfg(TASK, device=device, num_envs=1)
        cfg.terminations = {}
        cfg.recorders = {}
        cfg.viewer.eye, cfg.viewer.lookat = eye, lookat
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
            speed = SPEED_AT_ZERO + SPEED_PER_UNIT * plan["tilt_speed"]
            return _resample(self.targets[self.pour_start: self.pour_end], speed)
        return self.targets[self.pour_end: self.return_end]

    # --- helpers ----------------------------------------------------------------

    def _run(self, targets):
        for target in targets:
            self._last = target
            self.env.step(torch.as_tensor(target, dtype=torch.float32, device=self.env.device)[None])
            if self.video:
                self.frames.append(self.env.render())
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

    def save_video(self, path, fps=20):
        if not self.frames:
            return None
        import imageio.v2 as imageio

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        imageio.mimwrite(path, self.frames, fps=fps, macro_block_size=1)
        path.with_suffix(".frames.json").write_text(json.dumps(self.frame_times))
        return path
