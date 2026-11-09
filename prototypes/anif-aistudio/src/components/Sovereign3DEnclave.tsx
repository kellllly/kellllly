import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Minimize2, RotateCcw, Shield, Eye, Cpu, Radio, Sparkles } from 'lucide-react';

interface Sovereign3DEnclaveProps {
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

export const Sovereign3DEnclave: React.FC<Sovereign3DEnclaveProps> = ({
  isFullScreen = false,
  onToggleFullScreen
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isRotating, setIsRotating] = useState(true);
  const [activeNode, setActiveNode] = useState<string>('HSM-CORE-FIPS140-3');
  const [fpsCounter, setFpsCounter] = useState(60);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Détection GPU / WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Initialisation Scène, Caméra & Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.FogExp2(0x070b14, 0.028);

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 420;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 7, 14);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.05; // Légèrement en dessous du sol
    controls.minDistance = 5;
    controls.maxDistance = 25;
    controls.target.set(0, 1.2, 0);

    // 3. Texture Procédurale Canvas pour le socle (Zéro 404)
    const createGridTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0a101d';
      ctx.fillRect(0, 0, 512, 512);

      ctx.strokeStyle = '#0e2238';
      ctx.lineWidth = 2;
      const step = 32;
      for (let x = 0; x <= 512; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();
      }
      for (let y = 0; y <= 512; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
      }

      // Anneau concentrique
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(256, 256, 180, 0, Math.PI * 2);
      ctx.stroke();

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      return tex;
    };

    const gridTex = createGridTexture();

    // 4. Éclairage Studio PBR
    const hemiLight = new THREE.HemisphereLight(0x06b6d4, 0x020617, 0.7);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(8, 12, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const cyanPointLight = new THREE.PointLight(0x06b6d4, 2.5, 12);
    cyanPointLight.position.set(0, 3, 0);
    scene.add(cyanPointLight);

    const emeraldPointLight = new THREE.PointLight(0x10b981, 1.8, 10);
    emeraldPointLight.position.set(0, 1.5, 0);
    scene.add(emeraldPointLight);

    // 5. Assemblage Composite Procédural (3–12 Parties Distinctes)
    const enclaveGroup = new THREE.Group();
    scene.add(enclaveGroup);

    // Partie 1 : Socle Flottant en Polygone Extrudé
    const baseGeo = new THREE.CylinderGeometry(5.2, 5.6, 0.4, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.8,
      map: gridTex
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.2;
    baseMesh.receiveShadow = !isSoftwareGl;
    enclaveGroup.add(baseMesh);

    // Anneau de néon circonférentiel sous le socle
    const rimGeo = new THREE.TorusGeometry(5.4, 0.08, 16, 64);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = -0.15;
    enclaveGroup.add(rimMesh);

    // Partie 2 : Le Cœur Cryptographique Souverain (Octaèdre central HSM FIPS 140-3)
    const coreGeo = new THREE.OctahedronGeometry(1.2, 0);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.15,
      metalness: 0.95,
      wireframe: false,
      emissive: 0x044654,
      emissiveIntensity: 0.6
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 2.4;
    coreMesh.castShadow = !isSoftwareGl;
    enclaveGroup.add(coreMesh);

    // Cage filaire protectrice autour du cœur
    const cageGeo = new THREE.IcosahedronGeometry(1.7, 1);
    const cageMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    const cageMesh = new THREE.Mesh(cageGeo, cageMat);
    cageMesh.position.copy(coreMesh.position);
    enclaveGroup.add(cageMesh);

    // Partie 3 : Baies Serveurs Radiales Nkok Tier-III (6 monolithes)
    const rackGeo = new THREE.BoxGeometry(0.7, 2.2, 0.9);
    const rackMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.85
    });

    const ledMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const rackCount = 6;
    const rackRadius = 3.6;

    for (let i = 0; i < rackCount; i++) {
      const angle = (i / rackCount) * Math.PI * 2;
      const rackGroup = new THREE.Group();
      rackGroup.position.x = Math.cos(angle) * rackRadius;
      rackGroup.position.z = Math.sin(angle) * rackRadius;
      rackGroup.position.y = 1.1;
      rackGroup.rotation.y = -angle + Math.PI / 2;

      const rackMesh = new THREE.Mesh(rackGeo, rackMat);
      rackMesh.castShadow = !isSoftwareGl;
      rackMesh.receiveShadow = !isSoftwareGl;
      rackGroup.add(rackMesh);

      // Indicateurs LED d'activité sur chaque baie
      for (let l = 0; l < 4; l++) {
        const ledGeo = new THREE.BoxGeometry(0.5, 0.04, 0.02);
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.set(0, -0.6 + l * 0.4, 0.46);
        rackGroup.add(ledMesh);
      }

      enclaveGroup.add(rackGroup);
    }

    // Partie 4 : Anneaux de Chiffrement Orbitaux (Double Ratchet X25519)
    const ring1Geo = new THREE.TorusGeometry(2.5, 0.04, 16, 64);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x78350f,
      emissiveIntensity: 0.4
    });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.position.copy(coreMesh.position);
    ring1.rotation.x = Math.PI / 3;
    enclaveGroup.add(ring1);

    const ring2Geo = new THREE.TorusGeometry(2.9, 0.03, 16, 64);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.4
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.position.copy(coreMesh.position);
    ring2.rotation.y = Math.PI / 4;
    enclaveGroup.add(ring2);

    // Partie 5 : Faisceaux de Particules Cryptographiques (InstancedMesh)
    const particleCount = 70;
    const particleGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);

    const dummy = new THREE.Object3D();
    const particleData: { angle: number; radius: number; speed: number; y: number }[] = [];

    for (let i = 0; i < particleCount; i++) {
      particleData.push({
        angle: Math.random() * Math.PI * 2,
        radius: 1.8 + Math.random() * 2.8,
        speed: 0.01 + Math.random() * 0.02,
        y: 0.4 + Math.random() * 3.2
      });
      dummy.position.set(0, 0, 0);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }
    enclaveGroup.add(particleMesh);

    // 6. Boucle de Rendu Damped 60 FPS
    let animId: number;
    let lastTime = performance.now();
    let frameTimes: number[] = [];

    const animate = (time: number) => {
      animId = requestAnimationFrame(animate);

      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // FPS calculation
      frameTimes.push(time);
      if (frameTimes.length > 30) {
        frameTimes.shift();
        const duration = (time - frameTimes[0]) / 1000;
        setFpsCounter(Math.round(frameTimes.length / duration));
      }

      // Animations continues du Cœur
      coreMesh.rotation.y += 0.8 * dt;
      coreMesh.rotation.x += 0.4 * dt;
      cageMesh.rotation.y -= 0.5 * dt;

      ring1.rotation.z += 1.2 * dt;
      ring2.rotation.x += 0.9 * dt;

      // Mouvement des particules chiffrées
      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.angle += p.speed;
        dummy.position.x = Math.cos(p.angle) * p.radius;
        dummy.position.z = Math.sin(p.angle) * p.radius;
        dummy.position.y = p.y + Math.sin(p.angle * 3) * 0.2;
        dummy.scale.setScalar(0.8 + Math.sin(p.angle * 5) * 0.4);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;

      if (isRotating) {
        enclaveGroup.rotation.y += 0.15 * dt;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    // 7. Redimensionnement réactif
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 8. Nettoyage strict (Three.js Skill Directive)
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);

      controls.dispose();
      renderer.dispose();

      baseGeo.dispose();
      baseMat.dispose();
      rimGeo.dispose();
      rimMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      cageGeo.dispose();
      cageMat.dispose();
      rackGeo.dispose();
      rackMat.dispose();
      ledMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      particleMesh.dispose();
      gridTex.dispose();

      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isRotating]);

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-slate-700/60 bg-[#070b14] shadow-2xl flex flex-col ${isFullScreen ? 'fixed inset-4 z-50' : 'w-full h-[450px]'}`}>
      {/* HUD de Contrôle Flottant Compact (Directive Three.js: <= 15% viewport) */}
      <div className="absolute top-3 left-3 z-20 flex items-center space-x-2 font-mono text-xs">
        <div className="bg-slate-950/90 border border-cyan-800/80 px-3 py-1.5 rounded-xl flex items-center space-x-2 shadow-lg backdrop-blur-md">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="font-bold text-white tracking-wider">ENCLAVE 3D NKOK</span>
          <span className="text-[10px] text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800">
            PBR // THREE.JS
          </span>
        </div>
        <div className="hidden sm:flex items-center space-x-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1.5 rounded-xl text-[11px] text-slate-400">
          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400 font-bold">{fpsCounter} FPS</span>
        </div>
      </div>

      {/* Dock de Contrôle d'Interaction */}
      <div className="absolute top-3 right-3 z-20 flex items-center space-x-2 font-mono text-xs">
        <button
          onClick={() => setIsRotating(!isRotating)}
          className={`px-2.5 py-1.5 rounded-xl border flex items-center space-x-1.5 transition-all ${
            isRotating
              ? 'bg-cyan-950/90 text-cyan-300 border-cyan-700'
              : 'bg-slate-900/90 text-slate-400 border-slate-700'
          }`}
          title="Activer/Arrêter l'auto-rotation de la scène"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isRotating ? 'Rotation' : 'Statique'}</span>
        </button>

        {onToggleFullScreen && (
          <button
            onClick={onToggleFullScreen}
            className="p-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl transition-colors"
            title={isFullScreen ? 'Réduire' : 'Plein écran 3D'}
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Conteneur WebGL Three.js */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Légende Télémétrique Basse */}
      <div className="absolute bottom-3 inset-x-3 z-20 flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-950/80 border border-slate-800/80 rounded-xl font-mono text-xs text-slate-400 pointer-events-auto">
        <div className="flex items-center space-x-2">
          <Shield className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-300">Cœur HSM Actif :</span>
          <strong className="text-cyan-400">{activeNode}</strong>
        </div>
        <div className="flex items-center space-x-3 text-[11px]">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>FIPS 140-3</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span>X25519 Ratchet</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Tier-III Nkok</span>
          </span>
        </div>
      </div>
    </div>
  );
};
