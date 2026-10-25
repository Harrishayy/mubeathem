"""Closer fixed human placement for the selected near-touch simulation.

The original robot, tool, controller and action units remain unchanged. Only the
static person's collision/visual bodies and eye camera move 13–17 cm toward the robot.
This scene is used for actual VLA observations as well as both execution branches.
"""

import hashlib
import math
from pathlib import Path
from unittest.mock import patch

from . import knife_physics

OriginalKnifeWorld = knife_physics.KnifeWorld
HUMAN_X_M = 1.02


class CloseKnifeWorld(OriginalKnifeWorld):
    def __init__(self, job):
        super().__init__(job)
        if job.get("scenario") != "near-close":
            return
        target_x = job.get("human_x_m", HUMAN_X_M)
        if not isinstance(target_x, (int, float)) or not math.isfinite(target_x) or not .98 <= target_x <= 1.02:
            raise ValueError("Closer scene human_x_m must be within 0.98..1.02 metres")
        shift = target_x-self.human_x
        # The original scene creates the two decorative eyes after the head.
        # Include them explicitly; robot/table/tool bodies stay at original poses.
        eyes = [self.pb.getBodyUniqueId(i, physicsClientId=self.client)
                for i in range(self.pb.getNumBodies(physicsClientId=self.client))][-2:]
        for body in [*self.human, *eyes]:
            position, orientation = self.pb.getBasePositionAndOrientation(body, physicsClientId=self.client)
            self.pb.resetBasePositionAndOrientation(body, [position[0]+shift, *position[1:]], orientation,
                                                    physicsClientId=self.client)
        self.human_x = target_x
        self.cameras["human"]["eye"][0] += shift
        self.pb.performCollisionDetection(physicsClientId=self.client)


def provenance(result, job):
    result["scene_source_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result["scene_change"] = {"human_x_m": job.get("human_x_m", HUMAN_X_M), "original_human_x_m": 1.15,
                              "description": "Fixed human proxy and eye camera moved closer before real VLA observations; robot, knife and action mapping unchanged."}
    return result


def snapshot_scene(job):
    with patch.object(knife_physics, "KnifeWorld", CloseKnifeWorld):
        return provenance(knife_physics.snapshot_scene(job), job)


def simulate_actions(job):
    with patch.object(knife_physics, "KnifeWorld", CloseKnifeWorld):
        return provenance(knife_physics.simulate_actions(job), job)
