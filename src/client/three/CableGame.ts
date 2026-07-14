import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { PlugShape, PuzzleDefinition } from '../../shared/types';
import { DEVICE_SPECS } from '../../shared/props';
import type { WorldTheme } from '../../shared/levels/campaign';
import { CABLE_RADIUS, FLOOR_GROUP, PEG_TOP_Y, cableGroupBit } from './config';

/** Fallback visual theme (the original purple switchboard palette). */
export const DEFAULT_THEME: Pick<
  WorldTheme,
  'sky' | 'fog' | 'panel' | 'chassis' | 'wall' | 'rim' | 'accent' | 'keyLight' | 'rimLightA' | 'rimLightB'
> = {
  sky: ['#3b2b8f', '#5a3aa8', '#123a6b'],
  fog: '#241a52',
  panel: '#191330',
  chassis: '#2a1d63',
  wall: '#5a3fb0',
  rim: '#8a6fe6',
  accent: '#25e6ff',
  keyLight: '#ffffff',
  rimLightA: '#ff3ea5',
  rimLightB: '#27d3ff',
};

export type GameTheme = typeof DEFAULT_THEME;

/**
 * CableGame — the 3D untangle game.
 *
 * Driven by a procedurally-generated PuzzleDefinition (a grid of ports + cables
 * between them). Each cable is a chain of physics rigid bodies rendered as a 3D
 * tube with a plug connector at each end. Cables collide in true 3D — they rest
 * on the board and on each other, stacking and knotting. Drag a plug to a free
 * socket to unwrap; when a cable's path is clear it retracts and frees its
 * sockets (the snowball).
 */

const SPACING = 1.8;
const SEG_MASS = 1.0;
/** Cable rest length as a multiple of the straight socket-to-socket distance (the slack). */
const CABLE_SLACK = 1.26;
/** Distance between adjacent collision spheres. Small => dense, gap-free collision body. */
const SEG_DIST = CABLE_RADIUS * 1.15;
/** Max force of the bend (skip-link) constraints. Higher => stiffer cable. */
const BEND_STIFFNESS = 90;
/** How high a grabbed plug lifts so its cable rides over the pile while dragging. */
const DRAG_LIFT = CABLE_RADIUS * 3.0;
/** Max pull force of the drag joint. High enough to feel firm, capped so it can't yank through cables. */
const DRAG_FORCE = 600;
/** Intro reveal duration (seconds) and how far the door swings open. */
const INTRO_DUR = 1.7;
const DOOR_OPEN_ANGLE = 2.25;
/**
 * Hard velocity cap applied to EVERY cable segment each frame. With a 1/120s
 * physics step a body moves at most SPEED/120 per step, so keeping this well
 * below (2 * CABLE_RADIUS) * 120 guarantees no segment can skip through another
 * cable between steps — knots hold even when you yank fast.
 */
const MAX_BODY_SPEED = 10;

type Peg = {
  portId: number;
  world: THREE.Vector3;
  anchor: CANNON.Body;
  socket: THREE.Mesh;
  /** Colored collar ring that fills the socket when a plug is seated in it. */
  seat: THREE.Mesh;
  seatMat: THREE.MeshStandardMaterial;
};

type CableEnd = {
  end: 'A' | 'B';
  body: CANNON.Body;
  pinConstraint: CANNON.Constraint | null;
  pegPortId: number;
  plug: THREE.Group;
  /** Bolted down: cannot be grabbed or relocated. */
  locked: boolean;
};

type Cable = {
  id: string;
  color: number;
  bodies: CANNON.Body[];
  links: CANNON.Constraint[];
  ends: [CableEnd, CableEnd];
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  cleared: boolean;
};

type Retracting = {
  points: THREE.Vector3[];
  anchor: THREE.Vector3;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  plugs: THREE.Group[];
  t: number;
};

/** A "connection secured" pulse ring played when a cable clears. */
type Burst = {
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  t: number;
};

export type CableGameCallbacks = {
  onMove: (moves: number) => void;
  onWin: (moves: number) => void;
  /** Plug picked up. */
  onGrab?: () => void;
  /** Grab attempt on a bolted (locked) end. */
  onDeny?: () => void;
  /** Plug seated in a new socket. */
  onSnap?: () => void;
  /** A cable cleared; chainIndex is 0 for the first in a cascade, 1, 2... for chained clears. */
  onClear?: (chainIndex: number) => void;
  /** Live wire grabbed while still crossing others (a +1 move zap was applied). */
  onZap?: () => void;
  /** A cable was cut with the Wire Cutter tool. */
  onCut?: () => void;
  /** A power surge fired, relocating a cable end. */
  onSurge?: () => void;
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export class CableGame {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PEG_TOP_Y);

  private world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  private def: PuzzleDefinition;
  private pegsByPort = new Map<number, Peg>();
  private cables: Cable[] = [];
  private retracting: Retracting[] = [];
  private bursts: Burst[] = [];
  private allCablesMask = 0;

  private dragCable: Cable | null = null;
  private dragEnd: CableEnd | null = null;
  private dragControl: CANNON.Body | null = null;
  private dragConstraint: CANNON.PointToPointConstraint | null = null;

  private clock = new THREE.Clock();
  private physicsAccumulator = 0;
  private clearTimer = 0;
  private moves = 0;
  private theme: GameTheme = DEFAULT_THEME;

  /** Cascade chain tracking: clears within CHAIN_WINDOW of each other chain up. */
  private lastClearAt = -Infinity;
  private chainIndex = 0;
  private elapsed = 0;

  /** Deny-wiggle animations for bolted plugs. */
  private denyAnims: Array<{ plug: THREE.Group; t: number; baseQuat: THREE.Quaternion }> = [];

  // -- Mechanics state --------------------------------------------------------
  /** W3+: this cable resolves only when it is the last one on the board. */
  private goldenId: string | null = null;
  /** W4+: grabbing this cable while it crosses others costs +1 move. */
  private liveWireId: string | null = null;
  /** W5+: board is dark; a flashlight cone tracks the pointer. */
  private blackout = false;
  /** Wire Cutter tool armed: next tap cuts a cable instead of grabbing. */
  private cutMode = false;
  /** Lights kept as fields so blackout can dim them. */
  private ambient!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private flashlight: THREE.SpotLight | null = null;
  private flashTarget: THREE.Object3D | null = null;
  /** Last pointer position projected onto the board (drives the flashlight). */
  private lastPlanePoint = new THREE.Vector3(0, PEG_TOP_Y, 0);
  /** Cables that pulse (golden). */
  private pulsers: Array<{ material: THREE.MeshStandardMaterial; base: number }> = [];
  /** Seat-collar snap-in animations (scale pop when a plug seats). */
  private seatPops: Array<{ mesh: THREE.Mesh; t: number }> = [];

  /** Win confetti particles. */
  private confetti: Array<{
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    t: number;
  }> = [];

  // Intro: start with the door closed + camera pulled back, then swing the door
  // open and zoom into the board.
  private lidPivot: THREE.Group | null = null;
  private introT = 0;
  private baseCameraDist = 10;
  private callbacks: CableGameCallbacks;

  private pegMat!: THREE.MeshStandardMaterial;
  private bezelMat!: THREE.MeshStandardMaterial;
  private holeMat!: THREE.MeshStandardMaterial;
  private plugHousingMat!: THREE.MeshStandardMaterial;
  private twistTex!: THREE.Texture;
  private canvas: HTMLCanvasElement;

  constructor(
    canvas: HTMLCanvasElement,
    definition: PuzzleDefinition,
    callbacks: CableGameCallbacks,
    theme: GameTheme = DEFAULT_THEME
  ) {
    this.canvas = canvas;
    this.def = definition;
    this.callbacks = callbacks;
    this.theme = theme;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Vibrant backdrop with distance fog for depth (themed per world).
    this.scene.background = this.buildBackground();
    this.scene.fog = new THREE.Fog(hexToNumber(this.theme.fog), 26, 54);

    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    // Direct top-down: look straight down the -Y axis with the board's far edge
    // pointing up on screen.
    this.camera.up.set(0, 0, -1);
    this.positionCamera();

    const solver = this.world.solver as CANNON.GSSolver;
    solver.iterations = 24;
    solver.tolerance = 0.0005;
    // Low friction so cables slide over each other instead of sticking/welding
    // in mid-board. They still block each other by volume.
    this.world.defaultContactMaterial.friction = 0.25;
    this.world.defaultContactMaterial.restitution = 0;
    this.world.defaultContactMaterial.contactEquationStiffness = 3e7;
    this.world.defaultContactMaterial.contactEquationRelaxation = 3;
    this.world.allowSleep = true;

    this.setupLights();
    this.setupBoard();
    this.setupPegs();
    this.buildCables();

    // Wire up the level's mechanics (visuals + lighting).
    this.goldenId = this.def.goldenCableId ?? null;
    this.liveWireId = this.def.liveWireCableId ?? null;
    this.blackout = this.def.blackout ?? false;
    this.applyMechanicVisuals();
    if (this.blackout) this.applyBlackout();

    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);

    this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);

    // Free all GPU resources so switching levels doesn't leak.
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    this.scene.clear();
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------
  // Coordinate mapping
  // -------------------------------------------------------------------------

  private portWorld(col: number, row: number): THREE.Vector3 {
    const offX = ((this.def.gridWidth - 1) * SPACING) / 2;
    const offZ = ((this.def.gridHeight - 1) * SPACING) / 2;
    return new THREE.Vector3(col * SPACING - offX, PEG_TOP_Y, row * SPACING - offZ);
  }

  /** Frames the whole board so it fits the viewport at any aspect ratio. */
  private positionCamera(): void {
    const boardW = (this.def.gridWidth - 1) * SPACING + 3;
    const boardD = (this.def.gridHeight - 1) * SPACING + 3;
    const aspect = window.innerWidth / window.innerHeight;

    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    // Straight down: board depth maps to screen height, width to screen width.
    const distForHeight = (boardD * 0.5) / Math.tan(vFov / 2);
    const distForWidth = (boardW * 0.5) / Math.tan(hFov / 2);
    // Extra margin so the enclosure rim frames the board.
    this.baseCameraDist = Math.max(distForHeight, distForWidth) * 1.3;

    this.camera.position.set(0, this.baseCameraDist * this.cameraZoomMul(), 0);
    this.camera.lookAt(0, 0, 0);
  }

  /** Camera pull-back multiplier during the intro zoom-in (1 once settled). */
  private cameraZoomMul(): number {
    if (this.introT >= 1) return 1;
    const e = this.introT * this.introT * (3 - 2 * this.introT); // smoothstep
    return 1 + 1.05 * (1 - e);
  }

  // -------------------------------------------------------------------------
  // Scene
  // -------------------------------------------------------------------------

  /** Vertical gradient sky/backdrop. */
  private buildBackground(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, this.theme.sky[0]);
    g.addColorStop(0.5, this.theme.sky[1]);
    g.addColorStop(1, this.theme.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Subtle brushed panel texture with a faint grid, for the board top. */
  private buildPanelTexture(): THREE.Texture {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = this.theme.panel;
    ctx.fillRect(0, 0, size, size);
    // faint speckle for a matte surface (kept dark so cables pop)
    for (let i = 0; i < 2600; i++) {
      const v = 24 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${v + 6},${v},${v + 20})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    // grid guide lines with a violet tint
    ctx.strokeStyle = 'rgba(150,120,230,0.12)';
    ctx.lineWidth = 2;
    const step = size / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupLights(): void {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambient);

    // Hemisphere fill: soft sky/ground bounce so the board feels lit and lively
    // instead of murky. Sky tint follows the world's key light color.
    this.hemi = new THREE.HemisphereLight(hexToNumber(this.theme.keyLight), 0x2a2340, 0.7);
    this.hemi.position.set(0, 20, 0);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(hexToNumber(this.theme.keyLight), 1.45);
    this.keyLight = key;
    key.position.set(7, 20, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    key.shadow.bias = -0.0004;
    const s = 20;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    this.scene.add(key);

    // Colored rim lights for a lively, saturated look (themed per world).
    const rimA = new THREE.PointLight(hexToNumber(this.theme.rimLightA), 1.25, 55, 2);
    rimA.position.set(-11, 9, 6);
    this.scene.add(rimA);

    const rimB = new THREE.PointLight(hexToNumber(this.theme.rimLightB), 1.25, 55, 2);
    rimB.position.set(11, 9, -6);
    this.scene.add(rimB);

    const gold = new THREE.PointLight(0xffe0a0, 0.7, 50, 2);
    gold.position.set(0, 11, 10);
    this.scene.add(gold);
  }

  private setupBoard(): void {
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      collisionFilterGroup: FLOOR_GROUP,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floorBody);

    const w = (this.def.gridWidth - 1) * SPACING + 2.6;
    const h = (this.def.gridHeight - 1) * SPACING + 2.6;

    // Recessed inner panel the sockets/cables sit on.
    const panelTex = this.buildPanelTexture();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.5, h),
      new THREE.MeshStandardMaterial({
        map: panelTex,
        color: 0xb9bccb,
        roughness: 0.85,
        metalness: 0.25,
        emissive: hexToNumber(this.theme.accent),
        emissiveIntensity: 0.05,
      })
    );
    panel.position.y = -0.25;
    panel.receiveShadow = true;
    this.scene.add(panel);

    this.buildEnclosure(w, h);
    this.buildDoor(w, h);
  }

  /**
   * A custom switchboard enclosure built to match the scene palette: a steel
   * chassis with a recessed well, raised side walls, an accent-trim rim, and
   * corner screws. Colored to sit in the dark-navy environment with a teal trim
   * that echoes the cable palette.
   */
  private buildEnclosure(w: number, h: number): void {
    const wallT = 0.7;
    const outerW = w + wallT * 2;
    const outerH = h + wallT * 2;

    const chassisMat = new THREE.MeshStandardMaterial({ color: hexToNumber(this.theme.chassis), roughness: 0.6, metalness: 0.45 });
    const wallMat = new THREE.MeshStandardMaterial({ color: hexToNumber(this.theme.wall), roughness: 0.45, metalness: 0.6 });
    const rimMat = new THREE.MeshStandardMaterial({ color: hexToNumber(this.theme.rim), roughness: 0.3, metalness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: hexToNumber(this.theme.accent),
      roughness: 0.35,
      metalness: 0.4,
      emissive: hexToNumber(this.theme.accent),
      emissiveIntensity: 0.7,
    });
    const screwMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.25, metalness: 0.95 });

    // Chassis body sitting below and around the panel.
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(outerW + 0.4, 1.1, outerH + 0.4),
      chassisMat
    );
    chassis.position.y = -0.55;
    chassis.receiveShadow = true;
    chassis.castShadow = true;
    this.scene.add(chassis);

    // Four side walls forming the recessed well around the board.
    const wallH = 0.7;
    const wallY = 0.1;
    const addWall = (sx: number, sz: number, px: number, pz: number): void => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), wallMat);
      wall.position.set(px, wallY, pz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    };
    addWall(outerW, wallT, 0, -(h / 2 + wallT / 2)); // back
    addWall(outerW, wallT, 0, h / 2 + wallT / 2); // front
    addWall(wallT, h, -(w / 2 + wallT / 2), 0); // left
    addWall(wallT, h, w / 2 + wallT / 2, 0); // right

    // Rim flange along the wall tops + a thin glowing accent lip inside it.
    const rimY = wallY + wallH / 2 + 0.02;
    const addBar = (sx: number, sz: number, px: number, pz: number, mat: THREE.Material, y: number): void => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), mat);
      bar.position.set(px, y, pz);
      bar.castShadow = true;
      this.scene.add(bar);
    };
    const rimSpanX = outerW + 0.3;
    const rimSpanZ = outerH + 0.3;
    addBar(rimSpanX, wallT + 0.3, 0, -(h / 2 + wallT / 2), rimMat, rimY);
    addBar(rimSpanX, wallT + 0.3, 0, h / 2 + wallT / 2, rimMat, rimY);
    addBar(wallT + 0.3, rimSpanZ, -(w / 2 + wallT / 2), 0, rimMat, rimY);
    addBar(wallT + 0.3, rimSpanZ, w / 2 + wallT / 2, 0, rimMat, rimY);

    // Teal accent lip just inside the wall tops.
    const accentY = wallY + wallH / 2 - 0.04;
    const lipT = 0.12;
    addBar(w + lipT, lipT, 0, -(h / 2 + lipT / 2), accentMat, accentY);
    addBar(w + lipT, lipT, 0, h / 2 + lipT / 2, accentMat, accentY);
    addBar(lipT, h, -(w / 2 + lipT / 2), 0, accentMat, accentY);
    addBar(lipT, h, w / 2 + lipT / 2, 0, accentMat, accentY);

    // Corner screws on the rim.
    const screwGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.16, 6);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const screw = new THREE.Mesh(screwGeo, screwMat);
        screw.position.set(cx * (outerW / 2 + 0.05), rimY + 0.08, cz * (outerH / 2 + 0.05));
        screw.castShadow = true;
        this.scene.add(screw);
      }
    }
  }

  /** Hazard-stripe (yellow/black diagonal) texture for the door. */
  private buildHazardTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#111111';
    ctx.lineWidth = 0;
    for (let i = -128; i < 256; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 40, 0);
      ctx.lineTo(i + 40 + 128, 128);
      ctx.lineTo(i + 128, 128);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * A hinged metal door that covers the board when closed and swings open on
   * intro. Hinged along the board's far (-Z) edge; the free edge lifts up and
   * back to reveal the puzzle.
   */
  private buildDoor(w: number, h: number): void {
    const pivot = new THREE.Group();
    const doorY = PEG_TOP_Y + 0.45; // sits above the settled cables when closed
    pivot.position.set(0, doorY, -h / 2 - 0.15);

    const lid = new THREE.Group();
    lid.position.z = h / 2 + 0.15; // spans back across the board from the hinge

    const metalMat = new THREE.MeshStandardMaterial({
      color: hexToNumber(this.theme.wall),
      roughness: 0.4,
      metalness: 0.75,
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.16, h + 0.4), metalMat);
    panel.castShadow = true;
    panel.receiveShadow = true;
    lid.add(panel);

    // Raised rim border.
    const rimMat = new THREE.MeshStandardMaterial({ color: hexToNumber(this.theme.rim), roughness: 0.35, metalness: 0.82 });
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.1, h + 0.6), rimMat);
    rim.position.y = -0.06;
    lid.add(rim);

    // Hazard stripe across the door face.
    const hazard = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.42, 0.02, h * 0.22),
      new THREE.MeshStandardMaterial({ map: this.buildHazardTexture(), roughness: 0.6, metalness: 0.1 })
    );
    hazard.position.set(0, 0.09, -h * 0.18);
    lid.add(hazard);

    // Chunky handle near the free (+Z) edge.
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0ad, roughness: 0.3, metalness: 0.9 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.16, 0.22), handleMat);
    handle.position.set(0, 0.16, h * 0.34);
    handle.castShadow = true;
    lid.add(handle);
    for (const dx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), handleMat);
      post.position.set(dx * w * 0.17, 0.11, h * 0.34);
      lid.add(post);
    }

    pivot.add(lid);
    this.scene.add(pivot);
    this.lidPivot = pivot;
  }

  /**
   * Drives the opening sequence: door swings open while the camera zooms in
   * from the pulled-back "closed box" framing to the top-down board view.
   */
  private updateIntro(dt: number): void {
    if (this.introT >= 1) return;
    this.introT = Math.min(1, this.introT + dt / INTRO_DUR);

    // Camera zoom-in.
    this.camera.position.y = this.baseCameraDist * this.cameraZoomMul();
    this.camera.lookAt(0, 0, 0);

    // Door opens over the back 70% of the intro (a beat of "closed box" first).
    if (this.lidPivot) {
      const op = Math.min(1, Math.max(0, (this.introT - 0.3) / 0.7));
      const e = 1 - Math.pow(1 - op, 3); // easeOutCubic
      this.lidPivot.rotation.x = -DOOR_OPEN_ANGLE * e;
    }
  }

  private setupPegs(): void {
    // Socket bezel (brushed metal ring, faintly lit) + recessed hole.
    this.bezelMat = new THREE.MeshStandardMaterial({
      color: 0x454b60,
      roughness: 0.3,
      metalness: 0.9,
      emissive: hexToNumber(this.theme.accent),
      emissiveIntensity: 0.12,
    });
    this.pegMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3c, roughness: 0.55, metalness: 0.6 });
    this.holeMat = new THREE.MeshStandardMaterial({ color: 0x0c1120, roughness: 0.9 });

    const bezelGeo = new THREE.CylinderGeometry(CABLE_RADIUS * 2.0, CABLE_RADIUS * 2.1, 0.12, 24);
    const rimGeo = new THREE.CylinderGeometry(CABLE_RADIUS * 1.6, CABLE_RADIUS * 1.85, 0.34, 24);
    const holeGeo = new THREE.CylinderGeometry(CABLE_RADIUS * 1.25, CABLE_RADIUS * 1.25, 0.4, 20);
    // A colored collar that seats into the socket to sell the "plugged-in" look.
    const seatGeo = new THREE.CylinderGeometry(CABLE_RADIUS * 1.35, CABLE_RADIUS * 1.15, 0.22, 22);

    for (const port of this.def.ports) {
      const world = this.portWorld(port.col, port.row);

      const bezel = new THREE.Mesh(bezelGeo, this.bezelMat);
      bezel.position.set(world.x, 0.06, world.z);
      bezel.receiveShadow = true;
      this.scene.add(bezel);

      const rim = new THREE.Mesh(rimGeo, this.pegMat);
      rim.position.set(world.x, 0.04, world.z);
      rim.receiveShadow = true;
      this.scene.add(rim);

      const hole = new THREE.Mesh(holeGeo, this.holeMat);
      hole.position.set(world.x, 0.09, world.z);
      this.scene.add(hole);

      const seatMat = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.35,
        metalness: 0.4,
        emissive: 0x000000,
        emissiveIntensity: 0.5,
      });
      const seat = new THREE.Mesh(seatGeo, seatMat);
      seat.position.set(world.x, 0.16, world.z);
      seat.visible = false;
      this.scene.add(seat);

      const anchor = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        position: new CANNON.Vec3(world.x, PEG_TOP_Y, world.z),
        collisionFilterMask: 0,
      });
      this.world.addBody(anchor);

      this.pegsByPort.set(port.id, { portId: port.id, world, anchor, socket: rim, seat, seatMat });
    }
  }

  /**
   * Colors the seat collar of every occupied socket to match the plug in it
   * (steel-red for bolted ends), and hides collars of empty sockets. This is
   * the "plugged-in" cue, refreshed cheaply each frame (grid is small).
   */
  private updateSeats(): void {
    const occupied = new Map<number, { color: number; locked: boolean }>();
    for (const cable of this.cables) {
      if (cable.cleared) continue;
      for (const end of cable.ends) {
        // The end being dragged isn't seated anywhere yet.
        if (this.dragEnd === end) continue;
        occupied.set(end.pegPortId, { color: cable.color, locked: end.locked });
      }
    }
    for (const peg of this.pegsByPort.values()) {
      const occ = occupied.get(peg.portId);
      if (!occ) {
        peg.seat.visible = false;
        continue;
      }
      peg.seat.visible = true;
      const c = occ.locked ? 0x9aa0ad : occ.color;
      peg.seatMat.color.setHex(c);
      peg.seatMat.emissive.setHex(occ.locked ? 0x3a0000 : c);
      peg.seatMat.emissiveIntensity = occ.locked ? 0.3 : 0.35;
    }
  }

  // -------------------------------------------------------------------------
  // Cables
  // -------------------------------------------------------------------------

  /**
   * Builds a small greyscale diagonal-band texture. Wrapped helically around a
   * tube (diagonal in UV space), it reads as the twisted braid of a real cable.
   * Used as a bump + roughness map so it shades the surface without tinting it.
   */
  private buildTwistTexture(): THREE.Texture {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 5;
    for (let i = -size; i < size * 2; i += 12) {
      const shade = 90 + ((i / 12) % 2 === 0 ? 60 : 0);
      ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private buildCables(): void {
    this.plugHousingMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4b,
      roughness: 0.4,
      metalness: 0.7,
    });
    this.twistTex = this.buildTwistTexture();
    this.allCablesMask = 0;
    this.def.cables.forEach((_, i) => (this.allCablesMask |= cableGroupBit(i)));
    this.def.cables.forEach((cable, i) => this.cables.push(this.createCable(cable, i)));
  }

  private createCable(
    cableDef: PuzzleDefinition['cables'][number],
    index: number
  ): Cable {
    const color = hexToNumber(cableDef.color);
    const shape = DEVICE_SPECS[cableDef.deviceType].shape;
    const pegA = this.pegsByPort.get(cableDef.portA)!;
    const pegB = this.pegsByPort.get(cableDef.portB)!;
    const group = cableGroupBit(index);
    const mask = FLOOR_GROUP | (this.allCablesMask & ~group);

    // Length is proportional to the actual span so cables stretch across the
    // board (crossing others) instead of coiling up next to their own sockets.
    const straight = pegA.world.distanceTo(pegB.world);
    const slackMul = CABLE_SLACK * (this.def.slack ?? 1);
    const restLength = Math.max(straight * slackMul, SPACING);
    const segCount = Math.max(6, Math.round(restLength / SEG_DIST));

    const bodies: CANNON.Body[] = [];
    for (let i = 0; i <= segCount; i++) {
      const t = i / segCount;
      const p = pegA.world.clone().lerp(pegB.world, t);
      const body = new CANNON.Body({
        mass: SEG_MASS,
        shape: new CANNON.Sphere(CABLE_RADIUS),
        position: new CANNON.Vec3(p.x, PEG_TOP_Y, p.z),
        linearDamping: 0.5,
        angularDamping: 0.8,
        collisionFilterGroup: group,
        collisionFilterMask: mask,
        allowSleep: true,
        sleepSpeedLimit: 0.1,
        sleepTimeLimit: 0.6,
      });
      bodies.push(body);
      this.world.addBody(body);
    }

    const links: CANNON.Constraint[] = [];
    for (let i = 0; i < segCount; i++) {
      // High maxForce keeps the cable inextensible so it can't stretch out of a knot.
      const c = new CANNON.DistanceConstraint(bodies[i]!, bodies[i + 1]!, SEG_DIST, 1e8);
      this.world.addConstraint(c);
      links.push(c);
    }
    // Bending stiffness: soft skip-links (i -> i+2) resist sharp kinks so the
    // cable behaves like a semi-rigid wire, not a limp noodle. Low maxForce lets
    // it still curve and drape over other cables under load.
    for (let i = 0; i + 2 <= segCount; i++) {
      const c = new CANNON.DistanceConstraint(bodies[i]!, bodies[i + 2]!, SEG_DIST * 2, BEND_STIFFNESS);
      this.world.addConstraint(c);
      links.push(c);
    }

    const twist = this.twistTex.clone();
    twist.needsUpdate = true;
    twist.repeat.set(segCount * 1.3, 3);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.38,
      metalness: 0.18,
      bumpMap: twist,
      bumpScale: 0.04,
      roughnessMap: twist,
      emissive: color,
      emissiveIntensity: 0.14,
    });
    const mesh = new THREE.Mesh(this.buildTubeGeometry(bodies), material);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const lockA = cableDef.lockA ?? false;
    const lockB = cableDef.lockB ?? false;
    const endA: CableEnd = {
      end: 'A',
      body: bodies[0]!,
      pinConstraint: this.pinEnd(bodies[0]!, pegA.anchor),
      pegPortId: cableDef.portA,
      plug: this.createPlug(color, shape, lockA),
      locked: lockA,
    };
    const lastIdx = bodies.length - 1;
    const endB: CableEnd = {
      end: 'B',
      body: bodies[lastIdx]!,
      pinConstraint: this.pinEnd(bodies[lastIdx]!, pegB.anchor),
      pegPortId: cableDef.portB,
      plug: this.createPlug(color, shape, lockB),
      locked: lockB,
    };

    return { id: cableDef.id, color, bodies, links, ends: [endA, endB], mesh, material, cleared: false };
  }

  /**
   * A flat connector that lies on the board, long axis pointing outward along
   * the cable (local +Z = outward toward the socket). Seen from directly above
   * you read the connector silhouette: narrow for USB, wide for HDMI, round for
   * barrel/USB-C. Locked ends swap the colored collar for steel + a bolt cap.
   */
  private createPlug(color: number, shape: PlugShape, locked: boolean): THREE.Group {
    const group = new THREE.Group();
    const r = CABLE_RADIUS;

    const bodyLen = r * 2.6; // along local Z
    const bodyH = r * 1.3; // low profile
    let bodyW: number; // across local X
    let round = false;
    switch (shape) {
      case 'wide':
        bodyW = r * 3.0;
        break;
      case 'rect':
        bodyW = r * 1.9;
        break;
      case 'barrel':
        bodyW = r * 1.7;
        round = true;
        break;
      case 'round':
      default:
        bodyW = r * 1.5;
        round = true;
        break;
    }

    // Housing.
    let housing: THREE.Mesh;
    if (round) {
      const g = new THREE.CylinderGeometry(bodyW / 2, bodyW / 2, bodyLen, 20);
      g.rotateX(Math.PI / 2); // axis -> Z
      housing = new THREE.Mesh(g, this.plugHousingMat);
    } else {
      housing = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyLen), this.plugHousingMat);
    }
    group.add(housing);

    // Colored strain-relief collar at the cable (inner, -Z) end.
    const collar = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.9, bodyH * 0.95, r * 0.8),
      new THREE.MeshStandardMaterial({
        color: locked ? 0x707684 : color,
        roughness: 0.5,
        metalness: locked ? 0.7 : 0.25,
      })
    );
    collar.position.z = -bodyLen / 2 - r * 0.3;
    group.add(collar);

    // Metal contact lip at the outer (+Z) end.
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.7, bodyH * 0.7, r * 0.6),
      new THREE.MeshStandardMaterial({ color: 0xcfd3dc, roughness: 0.25, metalness: 0.9 })
    );
    lip.position.z = bodyLen / 2 + r * 0.2;
    group.add(lip);

    if (locked) {
      // A bolted bracket plate over the housing, two red bolt heads, and a red
      // warning ring — unmistakably different from a live plug.
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.15, bodyH * 0.5, bodyLen * 0.7),
        new THREE.MeshStandardMaterial({ color: 0x6a7080, roughness: 0.4, metalness: 0.9 })
      );
      plate.position.y = bodyH * 0.5;
      group.add(plate);

      const boltMat = new THREE.MeshStandardMaterial({
        color: 0xff3b3b,
        roughness: 0.35,
        metalness: 0.7,
        emissive: 0xff2020,
        emissiveIntensity: 0.55,
      });
      const boltGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, bodyH * 0.6 + 0.1, 8);
      for (const dz of [-bodyLen * 0.22, bodyLen * 0.22]) {
        const bolt = new THREE.Mesh(boltGeo, boltMat);
        bolt.position.set(0, bodyH * 0.75, dz);
        group.add(bolt);
      }

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(bodyW * 0.7, r * 0.14, 8, 20),
        new THREE.MeshStandardMaterial({
          color: 0xff3b3b,
          emissive: 0xff2020,
          emissiveIntensity: 0.6,
          roughness: 0.5,
          metalness: 0.3,
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = bodyH * 0.55;
      group.add(ring);
    }

    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(group);
    return group;
  }

  private pinEnd(body: CANNON.Body, anchor: CANNON.Body): CANNON.Constraint {
    const c = new CANNON.PointToPointConstraint(
      body,
      new CANNON.Vec3(0, 0, 0),
      anchor,
      new CANNON.Vec3(0, 0, 0),
      1e6
    );
    this.world.addConstraint(c);
    return c;
  }

  private buildTubeGeometry(bodies: CANNON.Body[]): THREE.TubeGeometry {
    const pts = bodies.map((b) => new THREE.Vector3(b.position.x, b.position.y, b.position.z));
    const tubular = Math.max(24, pts.length * 3);
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tubular, CABLE_RADIUS, 10, false);
  }

  /** Lays a plug flat at a cable end, long axis pointing outward along the cable. */
  private updatePlug(cable: Cable, end: CableEnd): void {
    const isA = end.end === 'A';
    const tipBody = isA ? cable.bodies[0]! : cable.bodies[cable.bodies.length - 1]!;
    const nextBody = isA ? cable.bodies[1]! : cable.bodies[cable.bodies.length - 2]!;
    const tip = new THREE.Vector3(tipBody.position.x, tipBody.position.y, tipBody.position.z);
    const next = new THREE.Vector3(nextBody.position.x, nextBody.position.y, nextBody.position.z);
    // Outward direction, flattened onto the board plane.
    const outward = new THREE.Vector3(tip.x - next.x, 0, tip.z - next.z);
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    outward.normalize();
    end.plug.position.set(tip.x, tip.y, tip.z);
    end.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
  }

  // -------------------------------------------------------------------------
  // Mechanics: golden cable, live wire, blackout, power surge, wire cutter
  // -------------------------------------------------------------------------

  /** Paints the golden and live-wire cables so players can read them at a glance. */
  private applyMechanicVisuals(): void {
    if (this.goldenId) {
      const gold = this.cables.find((c) => c.id === this.goldenId);
      if (gold) {
        gold.material.color = new THREE.Color(0xffd45a);
        gold.material.emissive = new THREE.Color(0xffb02e);
        gold.material.emissiveIntensity = 0.45;
        gold.material.metalness = 0.75;
        gold.material.roughness = 0.3;
        this.pulsers.push({ material: gold.material, base: 0.45 });
      }
    }
    if (this.liveWireId) {
      const live = this.cables.find((c) => c.id === this.liveWireId);
      if (live) {
        live.material.emissive = new THREE.Color(0xffe14d);
        live.material.emissiveIntensity = 0.5;
        this.pulsers.push({ material: live.material, base: 0.5 });
      }
    }
  }

  /** Kills the room lights and adds a pointer-tracking flashlight cone. */
  private applyBlackout(): void {
    this.ambient.intensity = 0.07;
    this.keyLight.intensity = 0.18;
    this.hemi.intensity = 0.05;
    this.scene.fog = new THREE.Fog(0x02030a, 12, 34);

    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    this.scene.add(target);
    this.flashTarget = target;

    const spot = new THREE.SpotLight(0xfff3d0, 5.5, 26, Math.PI / 6, 0.45, 1.1);
    spot.position.set(0, 9, 0);
    spot.target = target;
    spot.castShadow = true;
    this.scene.add(spot);
    this.flashlight = spot;
  }

  /** Moves the blackout flashlight to hover over the last pointer position. */
  private updateFlashlight(): void {
    if (!this.flashlight || !this.flashTarget) return;
    const p = this.lastPlanePoint;
    this.flashlight.position.set(p.x, 9, p.z);
    this.flashTarget.position.set(p.x, 0, p.z);
  }

  /** Snap-in pop for a seat collar: quick overshoot then settle. */
  private updateSeatPops(dt: number): void {
    for (const p of [...this.seatPops]) {
      p.t += dt / 0.32;
      if (p.t >= 1) {
        p.mesh.scale.set(1, 1, 1);
        this.seatPops = this.seatPops.filter((x) => x !== p);
        continue;
      }
      const s = 1 + 0.55 * Math.sin(p.t * Math.PI); // 1 -> ~1.55 -> 1
      p.mesh.scale.set(s, 1, s);
    }
  }

  /** Gentle emissive breathing for the golden / live-wire cables. */
  private updatePulsers(): void {
    if (this.pulsers.length === 0) return;
    const wave = 0.5 + 0.5 * Math.sin(this.elapsed * 3);
    for (const p of this.pulsers) {
      p.material.emissiveIntensity = p.base * (0.55 + 0.6 * wave);
    }
  }

  /** Arms/disarms Wire Cutter mode (next tap cuts a cable instead of grabbing). */
  setCutMode(on: boolean): void {
    this.cutMode = on;
    this.canvas.style.cursor = on ? 'crosshair' : 'default';
  }

  /** Cuts the cable nearest the given board point, retracting it immediately. */
  private cutCableWorld(hit: THREE.Vector3): boolean {
    let best: Cable | null = null;
    let bestDist = 1.6;
    for (const cable of this.cables) {
      if (cable.cleared) continue;
      for (const b of cable.bodies) {
        const d = Math.hypot(b.position.x - hit.x, b.position.z - hit.z);
        if (d < bestDist) {
          bestDist = d;
          best = cable;
        }
      }
    }
    if (!best) return false;
    this.setCutMode(false);
    this.clearCable(best, true);
    return true;
  }

  /**
   * A power surge: relocate one end of a random uncleared cable to a random
   * empty socket, re-tangling the board. Pressure, not punishment — the board
   * stays solvable because ends can always be moved back to any empty port.
   */
  triggerSurge(): void {
    const candidates = this.cables.filter((c) => !c.cleared && c !== this.dragCable);
    if (candidates.length === 0) return;

    const occupied = new Set<number>();
    for (const c of this.cables) {
      if (c.cleared) continue;
      for (const e of c.ends) occupied.add(e.pegPortId);
    }
    const emptyPorts = this.def.ports.map((p) => p.id).filter((id) => !occupied.has(id));
    if (emptyPorts.length === 0) return;

    const cable = candidates[Math.floor(Math.random() * candidates.length)]!;
    // Prefer a movable (unbolted) end.
    const movableEnds = cable.ends.filter((e) => !e.locked);
    if (movableEnds.length === 0) return;
    const end = movableEnds[Math.floor(Math.random() * movableEnds.length)]!;
    const targetPort = emptyPorts[Math.floor(Math.random() * emptyPorts.length)]!;

    this.relocateEnd(cable, end, targetPort);

    // Flash the surged cable so the player can see what moved.
    cable.material.emissive = new THREE.Color(0x7ec8ff);
    cable.material.emissiveIntensity = 1.1;
    this.pulsers.push({ material: cable.material, base: 0 });
    this.callbacks.onSurge?.();
  }

  /** Moves one cable end to a new port, re-pinning it and waking the chain. */
  private relocateEnd(cable: Cable, end: CableEnd, portId: number): void {
    if (end.pinConstraint) {
      this.world.removeConstraint(end.pinConstraint);
      end.pinConstraint = null;
    }
    const peg = this.pegsByPort.get(portId)!;
    end.pegPortId = portId;
    end.body.position.set(peg.world.x, PEG_TOP_Y, peg.world.z);
    end.pinConstraint = this.pinEnd(end.body, peg.anchor);
    for (const b of cable.bodies) {
      b.allowSleep = true;
      b.wakeUp();
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private updatePointer(e: PointerEvent): void {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  private pointerOnPlane(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.dragPlane, hit) ? hit : null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e);
    const hit = this.pointerOnPlane();
    if (!hit) return;
    this.lastPlanePoint.copy(hit);

    // Wire Cutter armed: this tap cuts the nearest cable instead of grabbing.
    if (this.cutMode) {
      this.cutCableWorld(hit);
      return;
    }

    let best: { cable: Cable; end: CableEnd } | null = null;
    let bestDist = 1.2;
    for (const cable of this.cables) {
      if (cable.cleared) continue;
      for (const end of cable.ends) {
        const p = end.body.position;
        const d = Math.hypot(p.x - hit.x, p.z - hit.z);
        if (d < bestDist) {
          bestDist = d;
          best = { cable, end };
        }
      }
    }
    if (!best) return;

    // Bolted end: deny with a struggle-wiggle + camera nudge instead of a grab.
    if (best.end.locked) {
      this.denyAnims.push({
        plug: best.end.plug,
        t: 0,
        baseQuat: best.end.plug.quaternion.clone(),
      });
      this.callbacks.onDeny?.();
      return;
    }

    // Live wire: grabbing it while it still crosses another cable zaps you (+1 move).
    if (best.cable.id === this.liveWireId && !this.isClear(best.cable)) {
      this.moves++;
      this.callbacks.onMove(this.moves);
      this.callbacks.onZap?.();
    }

    this.callbacks.onGrab?.();
    this.dragCable = best.cable;
    this.dragEnd = best.end;
    const body = best.end.body;
    if (best.end.pinConstraint) {
      this.world.removeConstraint(best.end.pinConstraint);
      best.end.pinConstraint = null;
    }
    // Wake the WHOLE cable and keep it awake for the duration of the drag —
    // otherwise sleeping segments stay stuck near the old socket while the
    // grabbed end pulls away, tearing the cable visually.
    for (const b of best.cable.bodies) {
      b.wakeUp();
      b.allowSleep = false;
    }

    // Attach a force-limited joint to a massless kinematic cursor. The end is
    // *pulled* toward the pointer (not teleported), so the solver still
    // resolves every collision — the cable shoves and drags others instead of
    // passing through them.
    const control = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    control.collisionFilterGroup = 0;
    control.collisionFilterMask = 0;
    control.position.set(body.position.x, PEG_TOP_Y + DRAG_LIFT, body.position.z);
    this.world.addBody(control);
    const joint = new CANNON.PointToPointConstraint(
      body,
      new CANNON.Vec3(0, 0, 0),
      control,
      new CANNON.Vec3(0, 0, 0),
      DRAG_FORCE
    );
    this.world.addConstraint(joint);
    this.dragControl = control;
    this.dragConstraint = joint;
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e);
    const hit = this.pointerOnPlane();
    if (!hit) return;
    this.lastPlanePoint.copy(hit);

    if (this.dragControl) {
      // Move the cursor target; the joint drags the cable end toward it.
      this.dragControl.position.set(hit.x, PEG_TOP_Y + DRAG_LIFT, hit.z);
      return;
    }

    // In cut mode the crosshair cursor stays; skip the grab-hover affordance.
    if (this.cutMode) return;

    // Hover affordance: show a grab cursor near any movable plug.
    let near = false;
    for (const cable of this.cables) {
      if (cable.cleared) continue;
      for (const end of cable.ends) {
        if (end.locked) continue;
        const p = end.body.position;
        if (Math.hypot(p.x - hit.x, p.z - hit.z) < 1.2) {
          near = true;
          break;
        }
      }
      if (near) break;
    }
    this.canvas.style.cursor = near ? 'grab' : 'default';
  };

  private onPointerUp = (): void => {
    if (!this.dragEnd || !this.dragCable) return;
    const end = this.dragEnd;
    const cable = this.dragCable;
    this.dragEnd = null;
    this.dragCable = null;

    if (this.dragConstraint) {
      this.world.removeConstraint(this.dragConstraint);
      this.dragConstraint = null;
    }
    if (this.dragControl) {
      this.world.removeBody(this.dragControl);
      this.dragControl = null;
    }
    // Re-enable sleeping and wake the whole chain so it fully re-settles at the
    // new position instead of leaving segments stranded at the old socket.
    for (const b of cable.bodies) {
      b.allowSleep = true;
      b.wakeUp();
    }

    const occupied = new Set<number>();
    for (const c of this.cables) {
      if (c.cleared) continue;
      for (const e of c.ends) if (e !== end) occupied.add(e.pegPortId);
    }
    let targetPort = end.pegPortId;
    let bestDist = 1.4;
    const bp = end.body.position;
    for (const [portId, peg] of this.pegsByPort) {
      if (occupied.has(portId)) continue;
      const d = Math.hypot(peg.world.x - bp.x, peg.world.z - bp.z);
      if (d < bestDist) {
        bestDist = d;
        targetPort = portId;
      }
    }

    if (targetPort !== end.pegPortId) {
      this.moves++;
      this.callbacks.onMove(this.moves);
      this.callbacks.onSnap?.();
    }
    end.pegPortId = targetPort;
    const peg = this.pegsByPort.get(targetPort)!;
    end.body.position.set(peg.world.x, PEG_TOP_Y, peg.world.z);
    end.pinConstraint = this.pinEnd(end.body, peg.anchor);
    // Snap-in pop on the socket collar to sell the "plugged-in" feel.
    this.seatPops.push({ mesh: peg.seat, t: 0 });
  };

  private onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.positionCamera();
  };

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private loop = (): void => {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);

    // Manual fixed substeps. We re-clamp every segment's speed BEFORE each
    // single step, so within one step a segment moves at most SPEED/120 units —
    // far less than a cable's diameter. That makes passing through another cable
    // geometrically impossible, no matter how hard you pull.
    const fixed = 1 / 120;
    this.physicsAccumulator = Math.min(this.physicsAccumulator + dt, fixed * 12);
    while (this.physicsAccumulator >= fixed) {
      this.clampCableSpeeds();
      this.world.step(fixed);
      this.physicsAccumulator -= fixed;
    }

    for (const cable of this.cables) {
      if (cable.cleared) continue;
      // Skip rebuilding fully-settled cables: saves work and stops idle jitter.
      const awake = cable === this.dragCable || cable.bodies.some((b) => b.sleepState !== CANNON.Body.SLEEPING);
      if (!awake) continue;
      cable.mesh.geometry.dispose();
      cable.mesh.geometry = this.buildTubeGeometry(cable.bodies);
      this.updatePlug(cable, cable.ends[0]);
      this.updatePlug(cable, cable.ends[1]);
    }

    this.elapsed += dt;
    if (++this.clearTimer % 6 === 0) this.checkClears();
    this.updateRetracting(dt);
    this.updateBursts(dt);
    this.updateConfetti(dt);
    this.updateDenyAnims(dt);
    this.updateIntro(dt);
    this.updatePulsers();
    this.updateSeats();
    this.updateSeatPops(dt);
    if (this.blackout) this.updateFlashlight();

    this.renderer.render(this.scene, this.camera);
  };

  // -------------------------------------------------------------------------
  // Clear detection & retraction
  // -------------------------------------------------------------------------

  /** Hard speed cap on every awake segment — the anti-tunnel guarantee. */
  private clampCableSpeeds(): void {
    for (const cable of this.cables) {
      if (cable.cleared) continue;
      for (const b of cable.bodies) {
        if (b.sleepState === CANNON.Body.SLEEPING) continue;
        const v = b.velocity;
        const sp = v.length();
        if (sp > MAX_BODY_SPEED) v.scale(MAX_BODY_SPEED / sp, v);
      }
    }
  }

  private checkClears(): void {
    for (const cable of this.cables) {
      if (cable.cleared || this.dragCable === cable) continue;
      // Golden cable settles LAST: it refuses to resolve while other cables
      // remain, even when its own path is clear.
      if (cable.id === this.goldenId && this.cables.length > 1) continue;
      if (this.isClear(cable)) this.clearCable(cable);
    }
  }

  private isClear(cable: Cable): boolean {
    const a = cable.bodies.map((b) => ({ x: b.position.x, y: b.position.z }));
    for (const other of this.cables) {
      if (other === cable || other.cleared) continue;
      const b = other.bodies.map((bd) => ({ x: bd.position.x, y: bd.position.z }));
      if (this.polylinesIntersect(a, b)) return false;
    }
    return true;
  }

  private clearCable(cable: Cable, viaCut = false): void {
    cable.cleared = true;
    const anchor = this.pegsByPort.get(cable.ends[0].pegPortId)!.world.clone();
    const points = cable.bodies.map(
      (b) => new THREE.Vector3(b.position.x, b.position.y, b.position.z)
    );

    for (const link of cable.links) this.world.removeConstraint(link);
    for (const end of cable.ends) if (end.pinConstraint) this.world.removeConstraint(end.pinConstraint);
    for (const body of cable.bodies) this.world.removeBody(body);

    cable.material.emissive = new THREE.Color(cable.color);
    cable.material.emissiveIntensity = 0.9;

    this.retracting.push({
      points,
      anchor,
      mesh: cable.mesh,
      material: cable.material,
      plugs: [cable.ends[0].plug, cable.ends[1].plug],
      t: 0,
    });

    // Pulse a ring at each socket the cable frees — an on-theme "secured" flash.
    this.spawnBurst(this.pegsByPort.get(cable.ends[0].pegPortId)!.world, cable.color);
    this.spawnBurst(this.pegsByPort.get(cable.ends[1].pegPortId)!.world, cable.color);

    if (viaCut) {
      // A deliberate snip: no cascade escalation, its own dedicated feedback.
      this.callbacks.onCut?.();
    } else {
      // Cascade chain: clears close together in time count as a chain, so the
      // UI/audio can escalate (pop, pop+2 semitones, arpeggio...).
      const CHAIN_WINDOW = 1.4;
      this.chainIndex = this.elapsed - this.lastClearAt < CHAIN_WINDOW ? this.chainIndex + 1 : 0;
      this.lastClearAt = this.elapsed;
      this.callbacks.onClear?.(this.chainIndex);
    }

    this.cables = this.cables.filter((c) => c !== cable);
    if (this.cables.length === 0) {
      this.spawnConfetti();
      this.callbacks.onWin(this.moves);
    }
  }

  /** Win celebration: a burst of tiny colored "plugs" raining over the board. */
  private spawnConfetti(): void {
    const colors = this.def.cables.map((c) => hexToNumber(c.color));
    const geo = new THREE.BoxGeometry(0.16, 0.06, 0.24);
    for (let i = 0; i < 70; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length]!,
        transparent: true,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.position.set((Math.random() - 0.5) * 6, 6 + Math.random() * 3, (Math.random() - 0.5) * 6);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, -2 - Math.random() * 2, (Math.random() - 0.5) * 3),
        spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        t: 0,
      });
    }
  }

  private updateConfetti(dt: number): void {
    for (const p of [...this.confetti]) {
      p.t += dt;
      p.vel.y -= 5 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - p.t / 2.2);
      if (p.t >= 2.2 || p.mesh.position.y < -2) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        mat.dispose();
        this.confetti = this.confetti.filter((x) => x !== p);
      }
    }
  }

  /** Struggle-wiggle on a bolted plug that was grabbed: fast decaying shake. */
  private updateDenyAnims(dt: number): void {
    for (const anim of [...this.denyAnims]) {
      anim.t += dt;
      const dur = 0.4;
      if (anim.t >= dur) {
        anim.plug.quaternion.copy(anim.baseQuat);
        this.denyAnims = this.denyAnims.filter((x) => x !== anim);
        continue;
      }
      const decay = 1 - anim.t / dur;
      const angle = Math.sin(anim.t * 55) * 0.16 * decay;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      anim.plug.quaternion.copy(anim.baseQuat).multiply(q);
    }
  }

  private spawnBurst(pos: THREE.Vector3, color: number): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CABLE_RADIUS * 1.5, CABLE_RADIUS * 2.1, 40),
      material
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.14, pos.z);
    this.scene.add(ring);
    this.bursts.push({ ring, material, t: 0 });
  }

  private updateBursts(dt: number): void {
    const speed = dt / 0.5;
    for (const b of [...this.bursts]) {
      b.t = Math.min(1, b.t + speed);
      const s = 1 + b.t * 5.5;
      b.ring.scale.set(s, s, 1);
      b.material.opacity = 0.85 * (1 - b.t);
      if (b.t >= 1) {
        this.scene.remove(b.ring);
        b.ring.geometry.dispose();
        b.material.dispose();
        this.bursts = this.bursts.filter((x) => x !== b);
      }
    }
  }

  private updateRetracting(dt: number): void {
    const speed = dt / 0.28;
    for (const r of [...this.retracting]) {
      r.t = Math.min(1, r.t + speed);
      const pts = r.points.map((p) => p.clone().lerp(r.anchor, r.t));
      r.mesh.geometry.dispose();
      const radius = Math.max(0.02, CABLE_RADIUS * (1 - r.t * 0.7));
      r.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 8, false);
      r.material.emissiveIntensity = 0.9 * (1 - r.t);
      for (const plug of r.plugs) plug.visible = false;
      if (r.t >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.material.dispose();
        for (const plug of r.plugs) this.scene.remove(plug);
        this.retracting = this.retracting.filter((x) => x !== r);
      }
    }
  }

  private polylinesIntersect(
    a: Array<{ x: number; y: number }>,
    b: Array<{ x: number; y: number }>
  ): boolean {
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        if (this.segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
      }
    }
    return false;
  }

  private segmentsIntersect(
    p1: { x: number; y: number },
    q1: { x: number; y: number },
    p2: { x: number; y: number },
    q2: { x: number; y: number }
  ): boolean {
    const d1x = q1.x - p1.x;
    const d1y = q1.y - p1.y;
    const d2x = q2.x - p2.x;
    const d2y = q2.y - p2.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return false;
    const dpx = p2.x - p1.x;
    const dpy = p2.y - p1.y;
    const t = (dpx * d2y - dpy * d2x) / denom;
    const u = (dpx * d1y - dpy * d1x) / denom;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }
}
