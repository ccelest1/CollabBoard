"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function ThreeBoardBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const pointLight = new THREE.PointLight(0x7dd3fc, 0.9);
    pointLight.position.set(3, 2, 5);
    scene.add(pointLight);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.1, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.8,
        metalness: 0.15,
      })
    );
    board.position.set(0, 0, -0.1);
    scene.add(board);

    const cursor = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
    );
    cursor.position.set(0.9, 0.2, 0.2);
    scene.add(cursor);

    const doodleA = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x22c55e })
    );
    doodleA.position.set(-0.7, 0.2, 0.2);
    scene.add(doodleA);

    const doodleB = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b })
    );
    doodleB.position.set(0.35, -0.35, 0.2);
    scene.add(doodleB);

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.35,
    });
    const gridGroup = new THREE.Group();
    const half = 8;
    const step = 0.5;

    for (let i = -half; i <= half; i += step) {
      const horizontalPoints = [new THREE.Vector3(-half, i, -2), new THREE.Vector3(half, i, -2)];
      const verticalPoints = [new THREE.Vector3(i, -half, -2), new THREE.Vector3(i, half, -2)];
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(horizontalPoints), lineMaterial));
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(verticalPoints), lineMaterial));
    }
    scene.add(gridGroup);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    const animate = () => {
      board.rotation.y += 0.002;
      gridGroup.rotation.z += 0.0007;
      cursor.position.x = 0.9 + Math.sin(Date.now() * 0.002) * 0.2;
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
      board.geometry.dispose();
      (board.material as THREE.Material).dispose();
      cursor.geometry.dispose();
      (cursor.material as THREE.Material).dispose();
      doodleA.geometry.dispose();
      (doodleA.material as THREE.Material).dispose();
      doodleB.geometry.dispose();
      (doodleB.material as THREE.Material).dispose();
      lineMaterial.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
