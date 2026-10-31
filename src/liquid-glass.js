import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const art = document.querySelector(".hero-art");
const canvas = document.querySelector("#liquid-canvas");

if (art && canvas) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 30);
    camera.position.set(0, 0, 7);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04).texture;
    scene.environment = environment;
    room.dispose();
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xfaf3e5, 0x4b3925, 1.2));
    const keyLight = new THREE.DirectionalLight(0xfff7e8, 2.8);
    keyLight.position.set(-2.5, 3.5, 5);
    scene.add(keyLight);
    const pointerLight = new THREE.PointLight(0xffd18a, 16, 9, 2);
    pointerLight.position.set(0, 0, 2.8);
    scene.add(pointerLight);
    const pointerLightTarget = new THREE.Vector3(0, 0, 2.8);

    const artHeight = 3.2;
    let artWidth = artHeight * 1.15;
    const backgroundGeometry = new THREE.PlaneGeometry(1, 1);
    const backgroundMaterial = new THREE.MeshBasicMaterial({ color: 0x201c17 });
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    background.position.z = -3;
    scene.add(background);

    const artImage = art.querySelector("img");
    const textureLoader = new THREE.TextureLoader();
    const backgroundTexture = textureLoader.load(
      artImage.currentSrc || artImage.src,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        updateTextureCrop(texture);
        backgroundMaterial.map = texture;
        backgroundMaterial.color.set(0xffffff);
        backgroundMaterial.needsUpdate = true;
        renderer.render(scene, camera);
      },
      undefined,
      () => art.classList.add("webgl-unavailable"),
    );
    backgroundTexture.colorSpace = THREE.SRGBColorSpace;

    const orbRadius = artHeight * 0.215;
    const orb = new THREE.Group();
    orb.position.set(artWidth * 0.24, artHeight * 0.075, -0.45);
    scene.add(orb);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xfff7e8,
      metalness: 0,
      roughness: 0.045,
      transmission: 1,
      thickness: 1.15,
      ior: 1.38,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      envMapIntensity: 1.65,
      specularIntensity: 1,
    });
    const glassSphere = new THREE.Mesh(
      new THREE.SphereGeometry(orbRadius, 88, 64),
      glassMaterial,
    );
    orb.add(glassSphere);

    const waves = [];
    for (let index = 0; index < 3; index += 1) {
      const geometry = new THREE.TorusGeometry(
        orbRadius * (1.16 + index * 0.2),
        orbRadius * 0.012,
        10,
        156,
      );
      const material = new THREE.MeshPhysicalMaterial({
        color: index === 1 ? 0xe6cb91 : 0xf8f0df,
        metalness: 0.22,
        roughness: 0.17,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        envMapIntensity: 1.25,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.position.set(0, -orbRadius * 0.72, 0.06 + index * 0.015);
      ring.rotation.x = 1.21;
      orb.add(ring);
      waves.push(ring);
    }

    const pointerTarget = new THREE.Vector2();
    let motionEnabled = !reducedMotion.matches;
    let artVisible = true;
    let loopRunning = false;
    let dragging = false;
    let dragMoved = false;
    let pointerId = null;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastFrameTime = performance.now();
    let pulseStartedAt = -1;

    function updateTextureCrop(texture) {
      if (!texture.image?.width || !texture.image?.height) return;
      const imageAspect = texture.image.width / texture.image.height;
      const viewportAspect = art.clientWidth / Math.max(art.clientHeight, 1);
      let repeatX = 1;
      let repeatY = 1;
      if (imageAspect > viewportAspect) repeatX = viewportAspect / imageAspect;
      else repeatY = imageAspect / viewportAspect;
      texture.repeat.set(repeatX, repeatY);
      texture.offset.set((1 - repeatX) * 0.65, (1 - repeatY) * 0.5);
      texture.needsUpdate = true;
    }

    function resize() {
      const width = Math.max(1, art.clientWidth);
      const height = Math.max(1, art.clientHeight);
      const aspect = width / height;
      artWidth = artHeight * aspect;
      camera.left = -artWidth / 2;
      camera.right = artWidth / 2;
      camera.top = artHeight / 2;
      camera.bottom = -artHeight / 2;
      camera.updateProjectionMatrix();
      background.scale.set(artWidth, artHeight, 1);
      orb.position.set(artWidth * 0.24, artHeight * 0.075, -0.45);
      renderer.setSize(width, height, false);
      updateTextureCrop(backgroundTexture);
      renderer.render(scene, camera);
    }

    function hasActivePulse(now) {
      return pulseStartedAt >= 0 && now - pulseStartedAt < 1450;
    }

    function stopLoop() {
      if (!loopRunning) return;
      renderer.setAnimationLoop(null);
      loopRunning = false;
    }

    function frame(now) {
      const delta = Math.min(Math.max((now - lastFrameTime) / 1000, 0), 0.04);
      lastFrameTime = now;
      const elapsed = now / 1000;
      pointerLight.position.lerp(pointerLightTarget, Math.min(1, delta * 4.8));

      if (motionEnabled && !dragging) {
        const idleY = Math.sin(elapsed * 0.23) * 0.035;
        const idleX = Math.cos(elapsed * 0.19) * 0.018;
        orb.rotation.y += ((pointerTarget.x * 0.12 + idleY) - orb.rotation.y) * Math.min(1, delta * 2.8);
        orb.rotation.x += ((pointerTarget.y * 0.08 + idleX) - orb.rotation.x) * Math.min(1, delta * 2.8);
      }

      const pulseActive = hasActivePulse(now);
      waves.forEach((ring, index) => {
        if (pulseActive) {
          const progress = (now - pulseStartedAt - index * 115) / 1120;
          if (progress < 0) {
            ring.material.opacity = 0.08;
            ring.scale.setScalar(0.9 + index * 0.1);
          } else if (progress <= 1) {
            ring.scale.setScalar(0.92 + progress * 0.62 + index * 0.1);
            ring.material.opacity = Math.sin(progress * Math.PI) * 0.56;
          } else {
            ring.material.opacity = 0.08;
          }
        } else {
          ring.material.opacity = 0.1 + Math.sin(elapsed * 0.42 + index) * 0.025;
          ring.scale.setScalar(1 + index * 0.12);
        }
      });

      renderer.render(scene, camera);
      if (!motionEnabled && !pulseActive && !dragging) stopLoop();
    }

    function startLoop() {
      if (!artVisible || document.hidden || loopRunning) return;
      lastFrameTime = performance.now();
      renderer.setAnimationLoop(frame);
      loopRunning = true;
    }

    function triggerRipple() {
      pulseStartedAt = performance.now();
      startLoop();
    }

    function shouldIgnorePointer(event) {
      return Boolean(event.target.closest("button, .record-sheet"));
    }

    art.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || shouldIgnorePointer(event)) return;
      dragging = true;
      dragMoved = false;
      pointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      art.classList.add("is-dragging");
      art.setPointerCapture(event.pointerId);
      startLoop();
    });

    art.addEventListener("pointermove", (event) => {
      if (shouldIgnorePointer(event)) return;
      const bounds = art.getBoundingClientRect();
      pointerTarget.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
      );
      pointerLightTarget.set(
        pointerTarget.x * artWidth * 0.36,
        -pointerTarget.y * artHeight * 0.36,
        2.8,
      );

      if (dragging && event.pointerId === pointerId) {
        const deltaX = event.clientX - lastPointerX;
        const deltaY = event.clientY - lastPointerY;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 2) dragMoved = true;
        orb.rotation.y += deltaX * 0.006;
        orb.rotation.x = THREE.MathUtils.clamp(orb.rotation.x + deltaY * 0.004, -0.32, 0.32);
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
      }
      if (motionEnabled || dragging) startLoop();
    });

    function endPointer(event) {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      art.classList.remove("is-dragging");
      if (event.type === "pointerup" && !dragMoved) triggerRipple();
      if (motionEnabled) startLoop();
    }

    art.addEventListener("pointerup", endPointer);
    art.addEventListener("pointercancel", endPointer);
    art.addEventListener("pointerleave", () => {
      if (!dragging) {
        pointerTarget.set(0, 0);
        pointerLightTarget.set(0, 0, 2.8);
      }
    });

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(art);
    resize();

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      artVisible = entry.isIntersecting;
      if (artVisible && motionEnabled) startLoop();
      else if (!artVisible) stopLoop();
    }, { threshold: 0.08 });
    visibilityObserver.observe(art);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopLoop();
      else if (artVisible && motionEnabled) startLoop();
    });

    reducedMotion.addEventListener?.("change", (event) => {
      if (event.matches) {
        motionEnabled = false;
        if (!hasActivePulse(performance.now())) stopLoop();
      }
    });

    if (motionEnabled) startLoop();
    art.classList.add("webgl-ready");
  } catch (error) {
    art.classList.add("webgl-unavailable");
    canvas.hidden = true;
    console.warn("Liquid glass scene unavailable; showing the still artwork.", error);
  }
}
