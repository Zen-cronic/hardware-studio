import type { Part, Vec3 } from './types';

/**
 * Editable camera drone starter: a 250 mm wheelbase quadcopter in millimetres, Y up, nose at +X.
 * Dimensions are declared design inputs, not flight, airworthiness or fabrication certification.
 *
 * Layout: carbon arms on the four diagonals, clamped between a carbon bottom plate and a
 * rounded, hollow printed body shell. The battery slots into the back of the body and a gimbal
 * hangs under the nose with the camera ball ahead of it. Motors sit at a 125 mm radius on the
 * arm tips with open 5 in propellers; `ducts` swaps them for 4 in propellers in printed ducts.
 */
export const DRONE_WHEELBASE_MM = 250;
export const DRONE_ARM_THICKNESS_MM = 4;
export const DRONE_ARM_IDS = ['arm-front-right', 'arm-front-left', 'arm-rear-left', 'arm-rear-right'] as const;

const CARBON = 'Carbon fibre plate (3K twill)', NYLON = 'PA12 nylon, printed';
// Declared colours follow the studio's finishes, so the in-room model looks like the studio one.
const CARBON_GREY = '#353C46', SATIN_BLACK = '#1A1D22', CHARCOAL = '#262B33', PROP_GREY = '#2B3542',
  SHELL_GREY = '#69737F', DUCT_GREY = '#3B434E', GRAPHITE = '#2A3038', LENS_BLUE = '#0E1A2A', LIGHT_BLUE = '#A2C7FF';
const MOTOR_RADIUS = DRONE_WHEELBASE_MM / 2;
const ARM = { inner: 28, outer: 137, width: 14 };
const BOTTOM_TOP = 33; // Top face of the 3 mm bottom plate; the arms sit on it.
const ARM_TOP = BOTTOM_TOP + DRONE_ARM_THICKNESS_MM; // The body shell and the ducts rest here.
const BODY = { front: 81, rear: -40, width: 56, height: 30, radius: 12, wall: 2 };
const DUCT = { bore: 106, wall: 110, lip: 114, height: 20, lipHeight: 3 };

export function droneParts(options: { ducts?: boolean } = {}): Part[] {
  const ducts = !!options.ducts, prop = ducts ? { inches: 4, span: 102, chord: 11 } : { inches: 5, span: 127, chord: 12 };
  const armLength = ARM.outer - ARM.inner, armCentre = (ARM.inner + ARM.outer) / 2, tip = MOTOR_RADIUS - armCentre;
  const armY = BOTTOM_TOP + DRONE_ARM_THICKNESS_MM / 2;
  const bodyY = ARM_TOP + BODY.height / 2, bodyLength = BODY.front - BODY.rear;
  const corners = [
    { key: 'front-right', label: 'front right', angle: Math.PI / 4 },
    { key: 'front-left', label: 'front left', angle: -Math.PI / 4 },
    { key: 'rear-left', label: 'rear left', angle: -3 * Math.PI / 4 },
    { key: 'rear-right', label: 'rear right', angle: 3 * Math.PI / 4 },
  ];
  // A box's local +X points along (cos θ, −sin θ) after a Y rotation θ, so θ = −angle.
  const at = (radius: number, angle: number, y: number): Vec3 => [round(radius * Math.cos(angle)), y, round(radius * Math.sin(angle))];
  const parts: Part[] = [
    { id: 'bottom-plate', name: 'Bottom frame plate', shape: 'box', size: [96, 3, 50], position: [12, BOTTOM_TOP - 1.5, 0],
      color: CARBON_GREY, material: CARBON, process: 'cut',
      holes: [{ x: -30, z: 0, diameter: 16 }, { x: 0, z: 18, diameter: 6 }, { x: 0, z: -18, diameter: 6 }] },
    // A closed, evenly thick printed shell; the flight controller sits inside it.
    { id: 'body-shell', name: 'Body shell', shape: 'box', size: [bodyLength, BODY.height, BODY.width], edgeRadius: BODY.radius, wall: BODY.wall,
      position: [round((BODY.front + BODY.rear) / 2), bodyY, 0], color: SHELL_GREY, material: NYLON, process: 'print' },
  ];
  for (const c of corners) {
    parts.push({
      id: 'arm-' + c.key, name: `Arm, ${c.label}`, shape: 'box', size: [armLength, DRONE_ARM_THICKNESS_MM, ARM.width],
      position: at(armCentre, c.angle, armY), rotation: [0, -c.angle, 0], color: CARBON_GREY, material: CARBON, process: 'cut',
      // Two frame bolts at the hub end; an M3 motor pair and a shaft clearance hole at the tip.
      holes: [
        { x: -armLength / 2 + 6, z: 0, diameter: 3.2 }, { x: -armLength / 2 + 20, z: 0, diameter: 3.2 },
        { x: tip - 8, z: 0, diameter: 3.2 }, { x: tip, z: 0, diameter: 7 }, { x: tip + 8, z: 0, diameter: 3.2 },
      ],
    });
  }
  for (const c of corners) {
    parts.push({ id: 'motor-mount-' + c.key, name: `Motor soft mount, ${c.label}`, shape: 'cylinder', size: [28, 2, 28],
      position: at(MOTOR_RADIUS, c.angle, ARM_TOP + 1), color: SATIN_BLACK, material: 'TPU 95A', process: 'print' });
    parts.push({ id: 'motor-' + c.key, name: `Motor 2306 envelope, ${c.label}`, shape: 'cylinder', size: [28, 18, 28],
      position: at(MOTOR_RADIUS, c.angle, ARM_TOP + 2 + 9), color: '#1d2127', material: 'Brushless motor 2306, 2450 KV', process: 'buy' });
    // A two-blade propeller, across the arm so it does not hide it; bought, so it is in the parts list and the AR model.
    parts.push({ id: 'prop-' + c.key, name: `Propeller ${prop.inches} in, ${c.label}`, shape: 'box', size: [prop.span, 3, prop.chord],
      position: at(MOTOR_RADIUS, c.angle, ARM_TOP + 2 + 18 + 1.5), rotation: [0, -c.angle + Math.PI / 2, 0], color: PROP_GREY,
      material: `Polycarbonate ${prop.inches} in two-blade propeller (purchased)`, process: 'buy' });
    // The duct rests on the arm and rises past the propeller; a wider rolled lip guides air in at the top.
    if (ducts) parts.push({ id: 'duct-' + c.key, name: `Propeller duct, ${c.label}`, shape: 'tube', size: [DUCT.lip, DUCT.height + DUCT.lipHeight, DUCT.lip],
      holeDiameter: DUCT.bore, sections: [{ height: DUCT.height, diameter: DUCT.wall, bore: DUCT.bore }, { height: DUCT.lipHeight, diameter: DUCT.lip, bore: DUCT.bore }],
      position: at(MOTOR_RADIUS, c.angle, ARM_TOP + (DUCT.height + DUCT.lipHeight) / 2), color: DUCT_GREY, material: NYLON, process: 'print' });
    parts.push({ id: 'leg-' + c.key, name: `Landing leg, ${c.label}`, shape: 'cylinder', size: [8, BOTTOM_TOP, 8],
      position: at(80, c.angle, BOTTOM_TOP / 2), color: SATIN_BLACK, material: 'TPU 95A', process: 'print' });
  }
  parts.push(
    { id: 'flight-controller', name: 'Flight controller stack, 30.5 mm', shape: 'box', size: [36, 6, 36], position: [16, ARM_TOP + BODY.wall + 3.5, 0],
      color: '#2f6b4f', material: 'FR-4 circuit board (purchased)', process: 'buy',
      holes: [{ x: 15.25, z: 15.25, diameter: 3.2 }, { x: 15.25, z: -15.25, diameter: 3.2 }, { x: -15.25, z: 15.25, diameter: 3.2 }, { x: -15.25, z: -15.25, diameter: 3.2 }] },
    // Slots into the back of the body and continues its outline, a little smaller so the seam shows.
    { id: 'battery', name: '4S 1300 mAh battery envelope', shape: 'box', size: [54, 27, 52], edgeRadius: 10, position: [BODY.rear - 27, ARM_TOP + 13.5, 0],
      color: CHARCOAL, material: 'LiPo pack (purchased envelope)', process: 'buy' },
    { id: 'camera-mount-left', name: 'Camera mount, left cheek', shape: 'box', size: [14, 22, 3], edgeRadius: 1.2, position: [70, ARM_TOP - 11, -15],
      color: SATIN_BLACK, material: 'TPU 95A', process: 'print' },
    { id: 'camera-mount-right', name: 'Camera mount, right cheek', shape: 'box', size: [14, 22, 3], edgeRadius: 1.2, position: [70, ARM_TOP - 11, 15],
      color: SATIN_BLACK, material: 'TPU 95A', process: 'print' },
    { id: 'camera', name: 'Camera ball, 26 mm gimbal envelope', shape: 'ellipsoid', size: [26, 26, 26], position: [74, 22, 0],
      color: GRAPHITE, material: 'Camera module (purchased)', process: 'buy' },
    // Lens window on the camera's +X axis.
    { id: 'camera-lens', name: 'Camera lens window', shape: 'cylinder', size: [12, 2, 12], position: [88, 22, 0], rotation: [0, 0, -Math.PI / 2],
      color: LENS_BLUE, material: 'Optical glass window (purchased)', process: 'buy' },
    { id: 'status-light', name: 'Status light strip', shape: 'box', size: [2, 3, 28], edgeRadius: 0.8, position: [BODY.front + 1, ARM_TOP + BODY.height / 2 + 1, 0],
      color: LIGHT_BLUE, material: 'LED light strip (purchased)', process: 'buy' },
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
