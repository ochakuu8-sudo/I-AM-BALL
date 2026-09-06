import RAPIER from '@dimforge/rapier3d-compat';

export function cameraFov(
  distance: number,
  aspect: number,
  radius: number,
  base: number,
) {
  // A close camera in portrait must still leave room around the ball to see the destruction.
  const framing =
    (Math.atan(
      radius / (Math.max(0.5, distance) * Math.min(1, aspect) * 0.72),
    ) *
      360) /
    Math.PI;
  return Math.max(base, Math.min(105, framing));
}

export class CameraBoom {
  distance = 17;
  probe = new RAPIER.Ball(0.3);
  reset() {
    this.distance = 17;
  }
  update(
    world: RAPIER.World,
    origin: RAPIER.Vector,
    direction: RAPIER.Vector,
    desiredDistance: number,
    dt: number,
  ) {
    // Walls and terrain constrain the view; flying fragments never pull it around.
    const hit = world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      direction,
      this.probe,
      0.08,
      desiredDistance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    const clearDistance = hit
      ? Math.max(0, hit.time_of_impact - 0.12)
      : desiredDistance;
    // Pull in immediately, including during a fast swipe; only the return is smoothed.
    this.distance =
      clearDistance < this.distance
        ? clearDistance
        : this.distance +
          (clearDistance - this.distance) * (1 - Math.exp(-5 * dt));
    return this.distance;
  }
}
