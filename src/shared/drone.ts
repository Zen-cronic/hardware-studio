import type { Part, Vec3 } from './types';

/**
 * Editable camera drone starter: a 250 mm wheelbase quadcopter frame in millimetres, Y up.
 * Dimensions are declared design inputs, not flight, airworthiness or fabrication certification.
 *
 * Layout: carbon arms sandwiched on the bottom plate along the four diagonals, motors at a
 * 125 mm radius, a top plate on four standoffs, the flight controller in the stack, the
 * battery strapped on top and the camera between two printed cheeks at the front (+X).
 */
export const DRONE_WHEELBASE_MM = 250;
export const DRONE_ARM_THICKNESS_MM = 4;
export const DRONE_ARM_IDS = ['arm-front-right', 'arm-front-left', 'arm-rear-left', 'arm-rear-right'] as const;

const CARBON = 'Carbon fibre plate (3K twill)';
const MOTOR_RADIUS = DRONE_WHEELBASE_MM / 2;
const ARM = { inner: 28, outer: 137, width: 14 };
const BOTTOM_TOP = 33; // Top face of the 3 mm bottom plate; the arms sit on it.
const LEG_HEIGHT = 30;

export function droneParts(): Part[] {
  const armLength = ARM.outer - ARM.inner, armCentre = (ARM.inner + ARM.outer) / 2, tip = MOTOR_RADIUS - armCentre;
  const armY = BOTTOM_TOP + DRONE_ARM_THICKNESS_MM / 2, armTop = BOTTOM_TOP + DRONE_ARM_THICKNESS_MM;
  const corners = [
    { key: 'front-right', label: 'front right', angle: Math.PI / 4 },
    { key: 'front-left', label: 'front left', angle: -Math.PI / 4 },
    { key: 'rear-left', label: 'rear left', angle: -3 * Math.PI / 4 },
    { key: 'rear-right', label: 'rear right', angle: 3 * Math.PI / 4 },
  ];
  // A box's local +X points along (cos θ, −sin θ) after a Y rotation θ, so θ = −angle.
  const at = (radius: number, angle: number, y: number): Vec3 => [round(radius * Math.cos(angle)), y, round(radius * Math.sin(angle))];
  const parts: Part[] = [
    { id: 'bottom-plate', name: 'Bottom frame plate', shape: 'box', size: [110, 3, 80], position: [0, BOTTOM_TOP - 1.5, 0],
      color: '#2b3138', material: CARBON, process: 'cut',
      holes: [{ x: -30, z: 0, diameter: 16 }, { x: 0, z: 26, diameter: 6 }, { x: 0, z: -26, diameter: 6 }] },
    { id: 'top-plate', name: 'Top frame plate', shape: 'box', size: [100, 2, 70], position: [0, 59, 0],
      color: '#2b3138', material: CARBON, process: 'cut',
      holes: [{ x: 0, z: 24, diameter: 6 }, { x: 0, z: -24, diameter: 6 }] },
  ];
  for (const c of corners) {
    parts.push({
      id: 'arm-' + c.key, name: `Arm, ${c.label}`, shape: 'box', size: [armLength, DRONE_ARM_THICKNESS_MM, ARM.width],
      position: at(armCentre, c.angle, armY), rotation: [0, -c.angle, 0], color: '#3a424c', material: CARBON, process: 'cut',
      // Two frame bolts at the hub end; an M3 motor pair and a shaft clearance hole at the tip.
      holes: [
        { x: -armLength / 2 + 6, z: 0, diameter: 3.2 }, { x: -armLength / 2 + 20, z: 0, diameter: 3.2 },
        { x: tip - 8, z: 0, diameter: 3.2 }, { x: tip, z: 0, diameter: 7 }, { x: tip + 8, z: 0, diameter: 3.2 },
      ],
    });
  }
  for (const c of corners) {
    parts.push({ id: 'motor-mount-' + c.key, name: `Motor soft mount, ${c.label}`, shape: 'cylinder', size: [28, 2, 28],
      position: at(MOTOR_RADIUS, c.angle, armTop + 1), color: '#4d7fbf', material: 'TPU 95A', process: 'print' });
    parts.push({ id: 'motor-' + c.key, name: `Motor 2306 envelope, ${c.label}`, shape: 'cylinder', size: [28, 18, 28],
      position: at(MOTOR_RADIUS, c.angle, armTop + 2 + 9), color: '#1d2127', material: 'Brushless motor 2306, 2450 KV', process: 'buy' });
    parts.push({ id: 'prop-' + c.key, name: `Propeller swept disc 5 in, ${c.label}`, shape: 'cylinder', size: [127, 2, 127],
      position: at(MOTOR_RADIUS, c.angle, armTop + 2 + 18 + 4), color: '#8fb8e8', material: 'Polycarbonate 5 in propeller (reference envelope)',
      process: 'buy', role: 'reference' });
    parts.push({ id: 'leg-' + c.key, name: `Landing leg, ${c.label}`, shape: 'cylinder', size: [10, LEG_HEIGHT + 3, 10],
      position: at(MOTOR_RADIUS - 12, c.angle, (LEG_HEIGHT + 3) / 2), color: '#4d7fbf', material: 'TPU 95A', process: 'print' });
  }
  for (const [x, z] of [[46, 12], [46, -12], [-46, 12], [-46, -12]] as const)
    parts.push({ id: `standoff-${x > 0 ? 'front' : 'rear'}-${z > 0 ? 'right' : 'left'}`, name: 'M3 aluminium standoff, 25 mm', shape: 'tube',
      size: [5, 25, 5], holeDiameter: 2.5, position: [x, BOTTOM_TOP + 12.5, z], color: '#9aa7b4', material: 'Aluminum 6061-T6', process: 'buy' });
  parts.push(
    { id: 'flight-controller', name: 'Flight controller stack, 30.5 mm', shape: 'box', size: [36, 6, 36], position: [-4, BOTTOM_TOP + 9, 0],
      color: '#2f6b4f', material: 'FR-4 circuit board (purchased)', process: 'buy',
      holes: [{ x: 15.25, z: 15.25, diameter: 3.2 }, { x: 15.25, z: -15.25, diameter: 3.2 }, { x: -15.25, z: 15.25, diameter: 3.2 }, { x: -15.25, z: -15.25, diameter: 3.2 }] },
    { id: 'battery', name: '4S 1300 mAh battery envelope', shape: 'box', size: [75, 35, 38], position: [-4, 60 + 17.5, 0],
      color: '#c9a227', material: 'LiPo pack (purchased envelope)', process: 'buy' },
    { id: 'camera-mount-left', name: 'Camera mount, left cheek', shape: 'box', size: [20, 24, 3], position: [45, BOTTOM_TOP + 12.5, -12],
      color: '#4d7fbf', material: 'TPU 95A', process: 'print' },
    { id: 'camera-mount-right', name: 'Camera mount, right cheek', shape: 'box', size: [20, 24, 3], position: [45, BOTTOM_TOP + 12.5, 12],
      color: '#4d7fbf', material: 'TPU 95A', process: 'print' },
    { id: 'camera', name: '19 mm camera module envelope', shape: 'box', size: [19, 19, 19], position: [45, BOTTOM_TOP + 12.5, 0],
      rotation: [0, 0, -0.35], color: '#15181c', material: 'Camera module (purchased)', process: 'buy' },
  );
  return parts;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** The same drone with every arm at a new thickness, centred on the same mid-plane. */
export function withDroneArmThickness(parts: Part[], thickness: number): Part[] {
  return parts.map(part => (DRONE_ARM_IDS as readonly string[]).includes(part.id)
    ? { ...part, size: [part.size[0], thickness, part.size[2]] as Vec3 } : part);
}
