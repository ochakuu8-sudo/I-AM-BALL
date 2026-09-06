export const CAMERA = { pitch: 0.44, minPitch: 0.16, maxPitch: 1.12 };
export const screenToWorld = (x: number, forward: number, yaw: number) => ({
  x: -Math.cos(yaw) * x + Math.sin(yaw) * forward,
  z: Math.sin(yaw) * x + Math.cos(yaw) * forward,
});

export class OrbitInput {
  yaw = 0;
  pitch = CAMERA.pitch;
  pointer: { id: number; x: number; y: number } | null = null;
  begin(id: number, x: number, y: number) {
    if (this.pointer) return false;
    this.pointer = { id, x, y };
    return true;
  }
  move(id: number, x: number, y: number, width: number, height: number) {
    if (this.pointer?.id !== id) return false;
    const dx = x - this.pointer.x,
      dy = y - this.pointer.y;
    // A screen-width swipe turns 300 degrees, independent of device DPR.
    this.yaw += ((dx / Math.max(320, width)) * Math.PI * 5) / 3;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.max(
      CAMERA.minPitch,
      Math.min(
        CAMERA.maxPitch,
        this.pitch + (dy / Math.max(320, height)) * 1.8,
      ),
    );
    this.pointer = { id, x, y };
    return true;
  }
  end(id: number) {
    if (this.pointer?.id === id) this.pointer = null;
  }
  cancel() {
    this.pointer = null;
  }
  reset() {
    this.cancel();
    this.yaw = 0;
    this.pitch = CAMERA.pitch;
  }
}
