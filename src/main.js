/**
 * Interactive Tavern Demo - Three.js + Rapier Physics + Gaussian Splats
 * 
 * This demo showcases the integration of:
 * - Spark library for Gaussian Splat rendering (@sparkjsdev/spark)
 * - Rapier physics engine for realistic collision detection
 * - Three.js for 3D graphics and scene management
 * - Web Audio API for spatial audio and interactive sound effects
 * 
 * Features:
 * - First-person controls with pointer lock
 * - Physics-based projectile shooting
 * - Animated characters with bone-level collision detection
 * - Gaussian splat environment rendering with collision mesh fallback
 * - Dynamic audio system with distance-based volume and velocity-based pitch
 * - Debug mode for visualizing collision spheres and transform controls
 * 
 * Controls:
 * - Click to enter first-person mode
 * - WASD: Move around
 * - R/F: Fly up/down
 * - Click: Shoot projectiles
 * - Space: Toggle debug mode (shows collision mesh instead of splats)
 */

import * as RAPIER from "@dimforge/rapier3d-compat";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ===================================================================================================
// CONFIGURATION
// ===================================================================================================

// const GLOBAL_SCALE = 2.2;
// const GLOBAL_SCALE = .7;  // hobbit
const GLOBAL_SCALE = 2.8;

const CONFIG = {
	// Physics
	GRAVITY: { x: 0, y: -9.81 * GLOBAL_SCALE, z: 0 },
	RAPIER_INIT_TIMEOUT: 10000,

	// Movement
	MOVE_SPEED: 3 * GLOBAL_SCALE,
	PROJECTILE_SPEED: 15 * GLOBAL_SCALE,

	// Audio
	VOICE_COOLDOWN: 1.0,
	MUSIC_VOLUME: 0.15,
	VOICE_VOLUME: 0.4,

	// Physics Objects
	PROJECTILE_RADIUS: 0.2 * GLOBAL_SCALE,
	PROJECTILE_RESTITUTION: 0.9,
	ENVIRONMENT_RESTITUTION: 0.0,
	BONE_COLLIDER_RADIUS: 0.3,

	// Audio Processing
	BOUNCE_DETECTION_THRESHOLD: 2.0,
	CHARACTER_HIT_DISTANCE: 0.8,
	VELOCITY_PITCH_RANGE: { min: 0.9, max: 1.1 },
	VOLUME_DISTANCE_MAX: 10,

	// Assets
	ENVIRONMENT: {
		// MESH: "kitchen_mesh.glb",
		// SPLATS: "kitchen_splats_500k.spz",
		// MESH: "britt_stitched.glb",
		// SPLATS: "britt_stitched.spz",
		// MESH: "hobbit_stitched.glb",
		// SPLATS: "hobbit_stitched.spz",
		// MESH: "britt_house_scene_mesh_0.glb",
		// SPLATS: "https://storage.googleapis.com/forge-dev-public/britt_house_2p5m.spz",
		// MESH: "stairs.glb",
		// SPLATS: "stairs.spz",
		MESH: "cozy_space_ship_mesh.glb",
		SPLATS: "https://public-spz.t3.storage.dev/cozy_space_ship.spz",
		SPLAT_SCALE: 3,
	},

	CHARACTERS: {
		ORC: {
			MODEL: "orc.glb",
			POSITION: [-2, 0., 0],
			ROTATION: Math.PI / 2,
			SCALE: [1, 1, 1],
		},
		BARTENDER: {
			MODEL: "Bartending.fbx",
			POSITION: [3.0, 0, 2],
			ROTATION: -Math.PI / 2,
			SCALE: [0.007, 0.007, 0.007],
		},
	},

	AUDIO_FILES: {
		BOUNCE: "bounce.mp3",
		BACKGROUND_MUSIC: "kitchen_music.mp3",
		// BACKGROUND_MUSIC: "hobbit_music.mp3",
		ORC_VOICES: [
			"lines/rocks.mp3",
			"lines/mushroom.mp3",
			"lines/watch.mp3",
			"lines/vex.mp3",
		],
		BARTENDER_VOICES: [
			"lines/working.mp3",
			"lines/juggler.mp3",
			"lines/drink.mp3",
		],
	},

	// Jenga tower (configurable)
	JENGA: {
		ENABLED: true,
		SCALE: 0.2, // overall scale factor (adjustable)
		LAYERS: 16,
		BRICK: { LEN: 3.0, WID: 1.0, HT: 0.6, GAP: 0.001 }, // base dims before SCALE
		ORIGIN: { x: -0.896, y: -0.063 - 0.7 + 0.001, z: 6.385 }, // bottom layer center (raised slightly)
	},

	// Grab/highlight
	GRAB: {
		MAX_DISTANCE: 3.0,
		HOLD_DISTANCE: 1.2,
		HIGHLIGHT_EMISSIVE: 0xffff00,
	},
};

// Player collider constants
// const PLAYER_RADIUS = 0.2 * GLOBAL_SCALE;
const PLAYER_RADIUS = 0.1 * GLOBAL_SCALE;
const PLAYER_HALF_HEIGHT = 0.5 * GLOBAL_SCALE; // total height ~= 2*half + 2*radius => 1.6m
const PLAYER_EYE_HEIGHT = 1.0 * GLOBAL_SCALE; // camera height above ground
const PLAYER_JUMP_SPEED = 8.0 * GLOBAL_SCALE; // jump impulse
const PROJECTILE_SPAWN_OFFSET = PLAYER_RADIUS + CONFIG.PROJECTILE_RADIUS + 0.15 * GLOBAL_SCALE;

// ===================================================================================================
// UTILITY FUNCTIONS
// ===================================================================================================

/**
 * Configures materials to respond properly to lighting
 * Converts MeshBasicMaterial to MeshStandardMaterial and adjusts properties
 */
function setupMaterialsForLighting(object, brightnessMultiplier = 1.0) {
	object.traverse((child) => {
		if (child.isMesh && child.material) {
			const materials = Array.isArray(child.material)
				? child.material
				: [child.material];
			const newMaterials = [];

			for (const material of materials) {
				// Remove emissive properties
				if (material.emissive) material.emissive.setHex(0x000000);
				if (material.emissiveIntensity !== undefined)
					material.emissiveIntensity = 0;

				// Convert basic materials to standard materials for lighting
				if (material.type === "MeshBasicMaterial") {
					const newMaterial = new THREE.MeshStandardMaterial({
						color: material.color,
						map: material.map,
						normalMap: material.normalMap,
						roughness: 0.8,
						metalness: 0.1,
					});
					newMaterials.push(newMaterial);
				} else {
					// Adjust existing material properties
					if (material.roughness !== undefined) material.roughness = 0.8;
					if (material.metalness !== undefined) material.metalness = 0.1;

					// Apply brightness multiplier
					if (material.color && brightnessMultiplier !== 1.0) {
						const currentColor = material.color.clone();
						currentColor.multiplyScalar(brightnessMultiplier);
						material.color = currentColor;
					}

					// Fix transparency issues
					if (material.transparent && material.opacity === 1) {
						material.transparent = false;
					}

					newMaterials.push(material);
				}
			}

			// Update mesh material reference
			child.material = Array.isArray(child.material)
				? newMaterials
				: newMaterials[0];
		}
	});
}

/**
 * Creates physics colliders for character bones
 */
function createBoneColliders(character, world) {
	const boneColliders = [];
	character.traverse((child) => {
		if (child.isBone) {
			const bonePos = new THREE.Vector3();
			child.getWorldPosition(bonePos);

			const colliderDesc = RAPIER.ColliderDesc.ball(
				CONFIG.BONE_COLLIDER_RADIUS,
			);
			const bodyDesc =
				RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
					bonePos.x,
					bonePos.y,
					bonePos.z,
				);

			const body = world.createRigidBody(bodyDesc);
			world.createCollider(colliderDesc, body);

			boneColliders.push({ bone: child, body });
		}
	});
	return boneColliders;
}

/**
 * Loads audio files and returns decoded audio buffers
 */
async function loadAudioFiles(audioContext, fileList) {
	try {
		const buffers = await Promise.all(
			fileList.map((file) =>
				fetch(file)
					.then((response) => response.arrayBuffer())
					.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
			),
		);
		return buffers;
	} catch (error) {
		console.error("Error loading audio files:", error);
		return [];
	}
}

/**
 * Plays audio with Web Audio API
 */
function playAudio(audioContext, buffer, volume = 1.0, playbackRate = 1.0) {
	if (!audioContext || !buffer) return;

	const source = audioContext.createBufferSource();
	const gainNode = audioContext.createGain();

	source.buffer = buffer;
	source.connect(gainNode);
	gainNode.connect(audioContext.destination);

	// Global mute scaling
	gainNode.gain.value = (window.__MUTED__ ? 0 : 1) * volume;
	source.playbackRate.value = playbackRate;
	source.start(0);

	return source;
}

// Fixed physics timestep (decouple physics from framerate)
const FIXED_TIME_STEP = 1 / 60;
const MAX_SUBSTEPS = 5;

// Global mute flag and helper
window.__MUTED__ = true;
function setMuted(m) {
	window.__MUTED__ = !!m;
	// Update UI icon if present
	const btn = document.getElementById("volumeToggle");
	if (btn) btn.textContent = window.__MUTED__ ? "🔇" : "🔊";
}

// ===================================================================================================
// MAIN APPLICATION
// ===================================================================================================

async function init() {
	// ===== RAPIER PHYSICS INITIALIZATION =====
	try {
		const initPromise = RAPIER.init();
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Rapier initialization timeout")),
				CONFIG.RAPIER_INIT_TIMEOUT,
			),
		);
		await Promise.race([initPromise, timeoutPromise]);
		console.log("✓ Rapier physics initialized");
	} catch (error) {
		console.error("Failed to initialize Rapier:", error);
		// Continue without physics - the demo will still show the environment
	}

	// ===== THREE.JS SCENE SETUP =====
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x202020);

	const camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000,
	);
	camera.rotation.y = Math.PI; // Start facing opposite direction

	const renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	// renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setPixelRatio(1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	// Spark renderer for splats (explicit), enable 32-bit sorting
	const sparkRenderer = new SparkRenderer({ renderer });
	console.log("created spark renderer");
	// Set sort32 on the default SparkViewpoint (per Spark docs), and enable radial sorting
	if (sparkRenderer.defaultView) {
		console.log("setting sort32");
		sparkRenderer.defaultView.sort32 = true;
		sparkRenderer.defaultView.sortRadial = true;
	}
	// Attach to camera to maintain precision and viewpoint alignment
	camera.add(sparkRenderer);

	document.body.appendChild(renderer.domElement);


	// ===== LIGHTING SETUP =====
	// Warm hemisphere lighting
	const hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x2a1a0a, 1.0);
	hemiLight.position.set(0, 20, 0);
	scene.add(hemiLight);

	// Warm directional lighting
	const dirLight = new THREE.DirectionalLight(0xffe6cc, 0.3);
	dirLight.position.set(3, 10, -5);
	scene.add(dirLight);

	// Atmospheric point light
	const pointLight = new THREE.PointLight(0xffa500, 2.0, 10);
	pointLight.position.set(-3.2, -1, 4.5);
	scene.add(pointLight);

	// ===== PHYSICS WORLD =====
	const world = new RAPIER.World(CONFIG.GRAVITY);

	// ===== JENGA TOWER SPAWN =====
	// Track dynamic Jenga bricks for transform syncing
	const jengaBlocks = [];
	// Map rapier body handle -> mesh for generic lookup (projectiles, jenga, etc.)
	const bodyToMesh = new Map();
	// Set of projectile rigid body handles (ignored for hover/grab)
	const projectileBodies = new Set();
	// Mesh → body mapping and list of grabbable meshes for THREE.Raycaster
	const meshToBody = new Map();
	const grabbableMeshes = [];
	function buildJengaTower(world, scene, cfg) {
		const scale = cfg.SCALE;
		const brickLen = cfg.BRICK.LEN * scale;
		const brickWid = cfg.BRICK.WID * scale;
		const brickHt = cfg.BRICK.HT * scale;
		const gap = cfg.BRICK.GAP * scale;
		const base = cfg.ORIGIN;

		for (let layer = 0; layer < cfg.LAYERS; layer++) {
			const alongZ = (layer % 2 === 0); // ||| then ___
			const sizeX = alongZ ? brickWid : brickLen;
			const sizeZ = alongZ ? brickLen : brickWid;
			const halfX = sizeX / 2;
			const halfY = brickHt / 2;
			const halfZ = sizeZ / 2;
			const y = base.y + halfY + layer * (brickHt + gap);

			// place 3 bricks across the transverse axis
			const pitch = (alongZ ? sizeX : sizeZ) + gap;
			for (let i = -1; i <= 1; i += 1) {
				const offset = i * pitch;
				const x = alongZ ? base.x + offset : base.x;
				const z = alongZ ? base.z : base.z + offset;

				// THREE mesh
				const geom = new THREE.BoxGeometry(sizeX, brickHt, sizeZ);
				const mat = new THREE.MeshStandardMaterial({ color: 0x0f0fff, metalness: 0.1, roughness: 0.8 });
				const mesh = new THREE.Mesh(geom, mat);
				mesh.position.set(x, y, z);
				scene.add(mesh);

				// Rapier body + collider
				const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
					.setTranslation(x, y, z)
					.setCanSleep(true)
					.setLinearDamping(0.1)
					.setAngularDamping(0.2);
				const body = world.createRigidBody(bodyDesc);
				const collider = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
					.setFriction(0.8)
					.setRestitution(0.05);
				world.createCollider(collider, body);

				// Track mesh with body in animation loop (separate from projectiles)
				jengaBlocks.push({ mesh, body });
				bodyToMesh.set(body.handle, mesh);
				meshToBody.set(mesh, body);
				grabbableMeshes.push(mesh);
			}
		}
	}

	if (CONFIG.JENGA.ENABLED) {
		buildJengaTower(world, scene, CONFIG.JENGA);
	}

	// Create FPS player capsule body
	let playerBody = null;
	{
		// const startY = 1.2;
		const startY = 7;
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(0, startY, 0)
			.lockRotations(true)
			.setLinearDamping(4.0)
			.setCcdEnabled(true);
		playerBody = world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.capsule(
			PLAYER_HALF_HEIGHT,
			PLAYER_RADIUS,
		)
			.setFriction(0.8)
			.setRestitution(0.0);
		world.createCollider(colliderDesc, playerBody);
	}

	// ===== CONTROLS SETUP =====
	const controls = new PointerLockControls(camera, document.body);

	// UI elements
	const startButton = document.getElementById("start");
	const infoElement = document.getElementById("info");
	const loadingElement = document.getElementById("loading");

	startButton.addEventListener("click", () => controls.lock());
	controls.addEventListener("lock", () => {
		infoElement.style.display = "none";
		const r = document.getElementById("reticle");
		if (r) r.style.display = "block";
	});
	controls.addEventListener("unlock", () => {
		infoElement.style.display = "";
		const r = document.getElementById("reticle");
		if (r) r.style.display = "none";
	});

	// ===== AUDIO SYSTEM =====
	let audioContext = null;
	const audioBuffers = {};
	const voiceCooldowns = { orc: 0, bartender: 0 };
	let musicSource = null;
	let musicGain = null;

	function initAudio() {
		if (audioContext) return;

		audioContext = new (window.AudioContext || window.webkitAudioContext)();

		// Load all audio files
		Promise.all([
			fetch(CONFIG.AUDIO_FILES.BOUNCE)
				.then((response) => response.arrayBuffer())
				.then((buffer) => audioContext.decodeAudioData(buffer))
				.then((buffer) => {
					audioBuffers.bounce = buffer;
					return buffer;
				}),

			loadAudioFiles(audioContext, CONFIG.AUDIO_FILES.ORC_VOICES).then(
				(buffers) => {
					audioBuffers.orcVoices = buffers;
					return buffers;
				},
			),

			loadAudioFiles(audioContext, CONFIG.AUDIO_FILES.BARTENDER_VOICES).then(
				(buffers) => {
					audioBuffers.bartenderVoices = buffers;
					return buffers;
				},
			),

			fetch(CONFIG.AUDIO_FILES.BACKGROUND_MUSIC)
				.then((response) => response.arrayBuffer())
				.then((buffer) => audioContext.decodeAudioData(buffer))
				.then((buffer) => {
					audioBuffers.backgroundMusic = buffer;
					startBackgroundMusic();
				}),
		])
			.then(() => {
				console.log("✓ Audio system initialized");
			})
			.catch((error) => {
				console.error("Audio loading error:", error);
			});
	}

	function startBackgroundMusic() {
		if (!audioContext || !audioBuffers.backgroundMusic) return;

		function playMusic() {
			const source = audioContext.createBufferSource();
			source.buffer = audioBuffers.backgroundMusic;
			musicGain = audioContext.createGain();
			source.connect(musicGain);
			musicGain.connect(audioContext.destination);
			musicGain.gain.value = window.__MUTED__ ? 0 : CONFIG.MUSIC_VOLUME;
			source.start(0);
			source.onended = playMusic; // Loop the music
			musicSource = source;
		}
		playMusic();
	}

	function playVoiceLine(character) {
		const cooldownKey = character;
		if (voiceCooldowns[cooldownKey] > 0) return;

		const voiceBuffers = audioBuffers[`${character}Voices`];
		if (!voiceBuffers || voiceBuffers.length === 0) return;

		const randomBuffer =
			voiceBuffers[Math.floor(Math.random() * voiceBuffers.length)];
		playAudio(audioContext, randomBuffer, CONFIG.VOICE_VOLUME);

		voiceCooldowns[cooldownKey] = CONFIG.VOICE_COOLDOWN;
		console.log(`${character} speaks`);
	}

	function playBounceSound(position, velocity) {
		if (!audioBuffers.bounce) return;

		// Calculate distance-based volume
		const distance = camera.position.distanceTo(position);
		let volume = Math.max(
			0.1,
			1.0 * (1 - distance / CONFIG.VOLUME_DISTANCE_MAX),
		);

		// Calculate velocity-based pitch and volume
		let pitch = 1.0;
		if (velocity) {
			const speed = velocity.length();
			const normalizedSpeed = Math.min(speed / 20, 1.0);
			volume *= 0.3 + normalizedSpeed * 0.7;
			pitch =
				CONFIG.VELOCITY_PITCH_RANGE.min +
				normalizedSpeed *
					(CONFIG.VELOCITY_PITCH_RANGE.max - CONFIG.VELOCITY_PITCH_RANGE.min);
			pitch *= 0.97 + Math.random() * 0.06; // Add slight random variation
		}

		playAudio(audioContext, audioBuffers.bounce, volume, pitch);
	}

	// Initialize audio on first user interaction
	document.addEventListener("click", initAudio, { once: true });
	document.addEventListener("keydown", initAudio, { once: true });

	// Wire volume button
	const volumeBtn = document.getElementById("volumeToggle");
	if (volumeBtn) {
		volumeBtn.addEventListener("click", () => {
			setMuted(!window.__MUTED__);
			// Update background music gain immediately
			if (musicGain) {
				musicGain.gain.value = window.__MUTED__ ? 0 : CONFIG.MUSIC_VOLUME;
			}
		});
		// Initialize icon state
		setMuted(window.__MUTED__);
	}

	// ===== ENVIRONMENT LOADING =====
	let environment = null;
	let splatMesh = null;
	let splatsLoaded = false;
	// Debug material handling for environment
	const envDebugMaterial = new THREE.MeshNormalMaterial();
	const originalEnvMaterials = new Map(); // mesh.uuid -> material or material[]

	loadingElement.style.display = "block";

	// Load collision mesh
	const gltfLoader = new GLTFLoader();
	gltfLoader.load(CONFIG.ENVIRONMENT.MESH, (gltf) => {
		environment = gltf.scene;
		// environment.scale.set(-1, -1, 1);
		// environment.scale.set(-1, 1, 1);
		environment.scale.set(1, 1, 1);
		scene.add(environment);

		// Create physics colliders from mesh geometry
		environment.traverse((child) => {
			if (child.isMesh) {
				const geometry = child.geometry.clone();
				child.updateWorldMatrix(true, false);
				geometry.applyMatrix4(child.matrixWorld);

				const vertices = new Float32Array(geometry.attributes.position.array);
				let indices;

				if (geometry.index) {
					indices = new Uint32Array(geometry.index.array);
				} else {
					const count = geometry.attributes.position.count;
					indices = new Uint32Array(count);
					for (let i = 0; i < count; i++) indices[i] = i;
				}

				const colliderDesc = RAPIER.ColliderDesc.trimesh(
					vertices,
					indices,
				).setRestitution(CONFIG.ENVIRONMENT_RESTITUTION);
				const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
				world.createCollider(colliderDesc, body);
			}
		});

		console.log("✓ Environment collision mesh loaded");
	});

	// Load Gaussian splats
	splatMesh = new SplatMesh({
		url: CONFIG.ENVIRONMENT.SPLATS,
		onLoad: () => {
			console.log(`✓ Gaussian splats loaded (${splatMesh.numSplats} splats)`);

			splatsLoaded = true;
			if (environment) environment.visible = false; // Hide collision mesh
			scene.add(splatMesh);
			loadingElement.style.display = "none";
		},
	});

	// Configure splat mesh
	const { SPLAT_SCALE } = CONFIG.ENVIRONMENT;
	// splatMesh.scale.set(SPLAT_SCALE, -SPLAT_SCALE, SPLAT_SCALE);
	// splatMesh.scale.set(SPLAT_SCALE, SPLAT_SCALE, SPLAT_SCALE);
	splatMesh.scale.set(1, 1, 1);
	splatMesh.position.set(0, 0, 0);

	// ===== CHARACTER LOADING =====
	const characters = {};
	const animationMixers = {};
	const boneColliders = {};

	// Load Orc
	gltfLoader.load(CONFIG.CHARACTERS.ORC.MODEL, (gltf) => {
		const orc = gltf.scene;
		const config = CONFIG.CHARACTERS.ORC;

		orc.rotation.y = config.ROTATION;
		orc.scale.set(...config.SCALE);
		orc.position.set(...config.POSITION);
		scene.add(orc);

		setupMaterialsForLighting(orc);

		// Setup animation
		if (gltf.animations && gltf.animations.length > 0) {
			animationMixers.orc = new AnimationMixer(orc);
			for (const clip of gltf.animations) {
				animationMixers.orc.clipAction(clip).play();
			}
		}

		boneColliders.orc = createBoneColliders(orc, world);
		characters.orc = orc;

		console.log("✓ Orc character loaded");
	});

	// Load Bartender
	const fbxLoader = new FBXLoader();
	fbxLoader.load(CONFIG.CHARACTERS.BARTENDER.MODEL, (fbx) => {
		const bartender = fbx;
		const config = CONFIG.CHARACTERS.BARTENDER;

		bartender.scale.set(...config.SCALE);
		bartender.position.set(...config.POSITION);
		bartender.rotation.y = config.ROTATION;
		scene.add(bartender);

		setupMaterialsForLighting(bartender, 2.0); // Make bartender brighter

		// Setup animation
		if (fbx.animations && fbx.animations.length > 0) {
			animationMixers.bartender = new AnimationMixer(bartender);
			for (const clip of fbx.animations) {
				animationMixers.bartender.clipAction(clip).play();
			}
		}

		boneColliders.bartender = createBoneColliders(bartender, world);
		characters.bartender = bartender;

		console.log("✓ Bartender character loaded");
	});

	// ===== INPUT HANDLING =====
	const keyState = {};
	let debugMode = false;
	const debugVisuals = { orc: [], bartender: [] };

	// Hover/grab state
	let hover = { body: null, mesh: null, savedEmissive: null };
	let grabbed = { body: null, mesh: null };

	// Keyboard input
	window.addEventListener("keydown", (e) => {
		keyState[e.code] = true;

		// Debug mode toggle → remapped to 'M'
		if (e.code === "KeyM") {
			debugMode = !debugMode;
			toggleDebugMode();
		}

		// Jump on Space if grounded
		if (e.code === "Space" && playerBody) {
			if (isPlayerGrounded()) {
				const v = playerBody.linvel();
				playerBody.setLinvel({ x: v.x, y: PLAYER_JUMP_SPEED, z: v.z }, true);
			}
		}

		// Print player position and orientation (yaw/pitch) on 'P'
		if (e.code === "KeyP") {
			if (playerBody) {
				const p = playerBody.translation();
				const posStr = `pos=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`;
				const forward = new THREE.Vector3();
				camera.getWorldDirection(forward);
				forward.normalize();
				// yaw around Y, pitch around X
				const yaw = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
				const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) * 180 / Math.PI;
				const rot = playerBody.rotation?.();
				const rotStr = rot ? `quat=(${rot.x.toFixed(3)}, ${rot.y.toFixed(3)}, ${rot.z.toFixed(3)}, ${rot.w.toFixed(3)})` : "";
				console.log(`[Player] ${posStr}  yaw=${yaw.toFixed(1)}°  pitch=${pitch.toFixed(1)}°  ${rotStr}`);
			} else {
				console.log("[Player] body not initialized yet");
			}
		}
	});

	window.addEventListener("keyup", (e) => {
		keyState[e.code] = false;
	});

	// Click: grab/release or shoot if nothing hovered
	window.addEventListener("click", () => {
		if (!controls.isLocked) return;
		// If currently holding something, release it
		if (grabbed.body) {
			grabbed = { body: null, mesh: null };
			return;
		}
		// If hovering a valid mapped mesh, grab it
		if (hover.body && hover.mesh) {
			grabbed = { body: hover.body, mesh: hover.mesh };
			return;
		}
		// Otherwise shoot
		shootProjectile();
	});

	function isPlayerGrounded() {
		if (!playerBody) return false;
		const p = playerBody.translation();
		// Cast from body center straight down well past the feet
		const origin = { x: p.x, y: p.y, z: p.z };
		const dir = { x: 0, y: -1, z: 0 };
		const ray = new RAPIER.Ray(origin, dir);
		const footOffset = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
		const hit = world.castRayAndGetNormal(ray, footOffset + 0.6, true);
		if (!hit) return false;
		const normalY = hit.normal ? hit.normal.y : 1.0;
		// Consider grounded if the ground is within a small margin below feet and not a steep wall
		const nearGround = hit.toi <= footOffset + 0.12 && normalY > 0.3;
		const vy = playerBody.linvel().y;
		return nearGround && vy <= 0.6;
	}

	function toggleDebugMode() {
		if (!environment || !splatMesh || !splatsLoaded) return;

		if (debugMode) {
			// Show collision mesh, hide splats
			environment.visible = true;
			scene.remove(splatMesh);

			// Swap environment materials to a bright normal-shaded view for clarity
			environment.traverse((child) => {
				if (child.isMesh) {
					if (!originalEnvMaterials.has(child.uuid)) {
						originalEnvMaterials.set(child.uuid, child.material);
					}
					child.material = envDebugMaterial;
				}
			});

			// Visualize bone colliders
			const characters = ["orc", "bartender"];
			for (let index = 0; index < characters.length; index++) {
				const character = characters[index];
				if (boneColliders[character] && debugVisuals[character].length === 0) {
					const color = index === 0 ? 0xff00ff : 0x00ffff;
					for (const { bone } of boneColliders[character]) {
						const pos = new THREE.Vector3();
						bone.getWorldPosition(pos);

						const sphere = new THREE.Mesh(
							new THREE.SphereGeometry(CONFIG.BONE_COLLIDER_RADIUS, 16, 16),
							new THREE.MeshBasicMaterial({ color, wireframe: true }),
						);
						sphere.position.copy(pos);
						scene.add(sphere);
						debugVisuals[character].push({ sphere, bone });
					}
				}
			}
		} else {
			// Hide collision mesh, show splats
			environment.visible = false;
			scene.add(splatMesh);

			// Restore original environment materials
			environment.traverse((child) => {
				if (child.isMesh && originalEnvMaterials.has(child.uuid)) {
					child.material = originalEnvMaterials.get(child.uuid);
				}
			});

			// Remove debug visuals
			for (const character of ["orc", "bartender"]) {
				for (const { sphere } of debugVisuals[character]) {
					scene.remove(sphere);
				}
				debugVisuals[character] = [];
			}
		}
	}

	// Movement
	function updateMovement(deltaTime) {
		if (!controls.isLocked || !playerBody) return;

		// Compute desired horizontal velocity from camera look
		const forward = new THREE.Vector3();
		camera.getWorldDirection(forward);
		forward.y = 0;
		forward.normalize();

		const right = new THREE.Vector3();
		right.crossVectors(forward, camera.up).normalize();

		const moveDir = new THREE.Vector3();
		if (keyState.KeyW) moveDir.add(forward);
		if (keyState.KeyS) moveDir.sub(forward);
		if (keyState.KeyD) moveDir.add(right);
		if (keyState.KeyA) moveDir.sub(right);

		let targetX = 0;
		let targetZ = 0;
		if (moveDir.lengthSq() > 0) {
			moveDir.normalize().multiplyScalar(CONFIG.MOVE_SPEED);
			// Project desired movement to slide along walls using a short forward ray
			const desired = moveDir.clone();
			const adjusted = adjustVelocityForWalls(desired);
			targetX = adjusted.x;
			targetZ = adjusted.z;
		}

		const current = playerBody.linvel();
		let targetY = current.y; // preserve vertical velocity (gravity)
		if (keyState.KeyR) targetY += CONFIG.MOVE_SPEED; // optional fly up
		if (keyState.KeyF) targetY -= CONFIG.MOVE_SPEED; // optional fly down

		playerBody.setLinvel({ x: targetX, y: targetY, z: targetZ }, true);
	}

	function adjustVelocityForWalls(desiredVel) {
		const v = desiredVel.clone();
		if (v.lengthSq() === 0) return v;
		const p = playerBody.translation();
		const horiz = new THREE.Vector3(v.x, 0, v.z);
		const len = horiz.length();
		if (len === 0) return v;
		horiz.normalize();
		// Raycast a small distance ahead at mid-body height
		const origin = { x: p.x, y: p.y, z: p.z };
		const dir = { x: horiz.x, y: 0, z: horiz.z };
		const ray = new RAPIER.Ray(origin, dir);
		const lookahead = PLAYER_RADIUS + 0.1;
		const hit = world.castRayAndGetNormal(ray, lookahead, true);
		const normal = hit?.normal;
		if (normal) {
			// Remove into-wall component: slide along wall
			const n = new THREE.Vector3(normal.x, normal.y, normal.z);
			n.y = 0; // only consider horizontal wall normal
			if (n.lengthSq() > 0.0001) {
				n.normalize();
				const vn = v.dot(n);
				if (vn > 0) v.addScaledVector(n, -vn);
			}
		}
		return v;
	}

	// ===== PROJECTILE SYSTEM =====
	const projectiles = [];

	function shootProjectile() {
		const geometry = new THREE.SphereGeometry(CONFIG.PROJECTILE_RADIUS, 16, 16);
		const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
		const mesh = new THREE.Mesh(geometry, material);

		const forward = new THREE.Vector3();
		camera.getWorldDirection(forward);
		forward.normalize();

		const origin = camera.position.clone().addScaledVector(forward, PROJECTILE_SPAWN_OFFSET);
		mesh.position.copy(origin);
		scene.add(mesh);

		// Create physics body
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(origin.x, origin.y, origin.z)
			.setCcdEnabled(true);
		const body = world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.ball(
			CONFIG.PROJECTILE_RADIUS,
		).setRestitution(CONFIG.PROJECTILE_RESTITUTION);
		world.createCollider(colliderDesc, body);

		// Launch projectile
		const velocity = forward.multiplyScalar(CONFIG.PROJECTILE_SPEED);
		body.setLinvel(velocity, true);

		projectiles.push({
			mesh,
			body,
			lastVelocity: velocity.clone(),
		});
		bodyToMesh.set(body.handle, mesh);
		projectileBodies.add(body.handle);
	}

	// ===== ANIMATION LOOP =====
	let previousTime = performance.now();
	let physicsAccumulator = 0;

	function animate(currentTime) {
		requestAnimationFrame(animate);
		const frameTime = Math.min((currentTime - previousTime) / 1000, 0.1);
		previousTime = currentTime;

		// Update movement controls → affects player body velocity
		updateMovement(frameTime);

		// Update voice cooldowns
		for (const key of Object.keys(voiceCooldowns)) {
			if (voiceCooldowns[key] > 0) voiceCooldowns[key] -= frameTime;
		}

		// Step physics simulation with fixed timestep
		physicsAccumulator += frameTime;
		const steps = Math.min(
			Math.floor(physicsAccumulator / FIXED_TIME_STEP),
			MAX_SUBSTEPS,
		);
		for (let i = 0; i < steps; i++) {
			world.step();

			// Update projectiles and detect collisions per substep
			for (const projectile of projectiles) {
				const pos = projectile.body.translation();
				const rot = projectile.body.rotation();

				projectile.mesh.position.set(pos.x, pos.y, pos.z);
				projectile.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

				const currentVelocity = new THREE.Vector3(
					projectile.body.linvel().x,
					projectile.body.linvel().y,
					projectile.body.linvel().z,
				);

				const velocityChange = currentVelocity
					.clone()
					.sub(projectile.lastVelocity);
				if (velocityChange.length() > CONFIG.BOUNCE_DETECTION_THRESHOLD) {
					const position = new THREE.Vector3(pos.x, pos.y, pos.z);
					playBounceSound(position, currentVelocity);

					for (const character of ["orc", "bartender"]) {
						if (boneColliders[character]) {
							const hit = boneColliders[character].some(({ bone }) => {
								const bonePos = new THREE.Vector3();
								bone.getWorldPosition(bonePos);
								return (
									position.distanceTo(bonePos) < CONFIG.CHARACTER_HIT_DISTANCE
								);
							});
							if (hit) playVoiceLine(character);
						}
					}
				}

				projectile.lastVelocity.copy(currentVelocity);
			}

			// Sync Jenga blocks (no special collision audio)
			for (const block of jengaBlocks) {
				const pos = block.body.translation();
				const rot = block.body.rotation();
				block.mesh.position.set(pos.x, pos.y, pos.z);
				block.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
			}

			// While grabbed: hold object in front of camera
			if (grabbed.body) {
				const forward = new THREE.Vector3();
				camera.getWorldDirection(forward);
				forward.normalize();
				const holdPos = camera.position.clone().addScaledVector(forward, CONFIG.GRAB.HOLD_DISTANCE);
				grabbed.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
				grabbed.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
				grabbed.body.setTranslation({ x: holdPos.x, y: holdPos.y, z: holdPos.z }, true);

				// Canonical rotation: face the camera direction with world-up (yaw-aligned)
				const yawForward = new THREE.Vector3(forward.x, 0, forward.z);
				if (yawForward.lengthSq() < 1e-6) yawForward.set(0, 0, 1);
				yawForward.normalize();
				const up = new THREE.Vector3(0, 1, 0);
				const right = new THREE.Vector3().crossVectors(up, yawForward).normalize();
				// Recompute up to ensure orthonormal basis
				const trueUp = new THREE.Vector3().crossVectors(yawForward, right).normalize();
				const basis = new THREE.Matrix4().makeBasis(right, trueUp, yawForward);
				const q = new THREE.Quaternion().setFromRotationMatrix(basis);
				grabbed.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
			}

			physicsAccumulator -= FIXED_TIME_STEP;
		}

		// Sync camera to player body (FPS view)
		if (playerBody) {
			const p = playerBody.translation();
			const feetY = p.y - (PLAYER_HALF_HEIGHT + PLAYER_RADIUS);
			camera.position.set(p.x, feetY + PLAYER_EYE_HEIGHT, p.z);
		}

		// Update Spark accumulation/sorting if autoUpdate path misses it
		sparkRenderer?.update({ scene });

		// Update hover highlight
		updateHover();

		// Update character animations
		for (const mixer of Object.values(animationMixers)) {
			mixer?.update(frameTime);
		}

		// Update bone colliders to follow animated bones
		for (const [character, colliders] of Object.entries(boneColliders)) {
			for (const { bone, body } of colliders) {
				const pos = new THREE.Vector3();
				bone.getWorldPosition(pos);
				body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
			}
		}

		// Update debug visuals
		if (debugMode) {
			for (const character of ["orc", "bartender"]) {
				for (const { sphere, bone } of debugVisuals[character]) {
					bone.getWorldPosition(sphere.position);
				}
			}

			
		}

		renderer.render(scene, camera);
	}

	function updateHover() {
		// Clear previous highlight
		if (hover.mesh && hover.savedEmissive != null) {
			const m = hover.mesh.material;
			if (m && m.emissive) m.emissive.setHex(hover.savedEmissive);
		}
		hover = { body: null, mesh: null, savedEmissive: null };

		// Use THREE.Raycaster against grabbable meshes for robust picking
		const raycaster = new THREE.Raycaster();
		raycaster.far = CONFIG.GRAB.MAX_DISTANCE;
		raycaster.setFromCamera({ x: 0, y: 0 }, camera);
		const hits = raycaster.intersectObjects(grabbableMeshes, false);
		if (!hits || hits.length === 0) return;
		const hit = hits.find(h => h.distance <= CONFIG.GRAB.MAX_DISTANCE);
		if (!hit) return;
		const mesh = hit.object;
		const bestBody = meshToBody.get(mesh);
		if (!mesh) return;
		const mat = mesh.material;
		if (mat && mat.emissive) {
			hover = { body: bestBody, mesh, savedEmissive: mat.emissive.getHex() };
			mat.emissive.setHex(CONFIG.GRAB.HIGHLIGHT_EMISSIVE);
		}
	}

	// ===== WINDOW RESIZE HANDLING =====
	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	// Start the animation loop
	animate(previousTime);
	console.log("🚀 Tavern demo initialized successfully!");
}

// Initialize the application
init();
