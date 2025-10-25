import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js';

export class MeleeProjectile {
  constructor({ scene, position, direction, weapon, attacker, onHit, type = 'circle', angle = Math.PI / 2, radius = 3, speed, startWidth }) {
    this.scene = scene;
    this.position = position.clone();
    this.direction = direction.clone().normalize();
    this.weapon = weapon;
    this.attacker = attacker;
    this.onHit = onHit;
    this.speed = (speed !== undefined) ? speed : (weapon.projectileSpeed !== undefined ? weapon.projectileSpeed : 20);
    this.range = weapon.reach || 20.0;
    this.traveled = 0;
    this.radius = (weapon.projectileSize !== undefined) ? weapon.projectileSize : (radius || weapon.radius || 0.3);
    
    this.angle = angle || weapon.angle || Math.PI / 2;
    this.type = type;
    this.isDestroyed = false;
    this.projectileEffect = weapon.projectileEffect || null;
    this.hitTargets = new Set();
    this.lifeTime = weapon.projectileLifeTime || 0.5; // weapon_data.json에서 설정 가능
    this.startWidth = (weapon.startWidth !== undefined) ? weapon.startWidth : (startWidth || 1.0);

    // 판정 활성화 상태 (여러 번 활성화 지원)
    this.isActive = false; // 현재 판정이 활성화되었는지
    this.elapsedTime = 0; // 경과 시간

    // 활성화 타이밍 배열 (weapon_data.json에서 설정)
    // 예: [{ start: 0.3, end: 0.4 }, { start: 0.6, end: 0.7 }]
    this.activationWindows = weapon.activationWindows || [{ start: 0, end: this.lifeTime }];
    this.currentWindowIndex = 0; // 현재 활성화 구간 인덱스

    // 디버그 메시 생성: 원거리 투사체(circle)만 생성
    this.debugMesh = this.createDebugMesh();
    if (this.debugMesh && this.scene) this.scene.add(this.debugMesh);
  }

  createDebugMesh() {
    if (this.type === 'sector' || this.type === 'aerial') {
      // 근접 공격(sector, aerial): 부채꼴 모양으로 시각화
      const geometry = new THREE.BufferGeometry();
      const vertices = [];
      const segments = 32; // 부채꼴의 부드러운 정도

      // 중심점
      vertices.push(0, 0, 0);

      // 부채꼴 호 생성
      for (let i = 0; i <= segments; i++) {
        const theta = (-this.angle / 2) + (this.angle * i / segments);
        const x = Math.sin(theta) * this.radius;
        const z = Math.cos(theta) * this.radius;
        vertices.push(x, 0, z);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

      // 인덱스 생성 (삼각형들)
      const indices = [];
      for (let i = 1; i <= segments; i++) {
        indices.push(0, i, i + 1);
      }
      geometry.setIndex(indices);

      // 초기 색상: 비활성화 상태 (파란색)
      const material = new THREE.MeshBasicMaterial({
        color: 0x4444ff, // 비활성화: 파란색
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.position);

      // 방향에 맞춰 회전
      const angle = Math.atan2(this.direction.x, this.direction.z);
      mesh.rotation.y = angle;

      return mesh;
    } else if (this.type === 'circle') {
      // 원거리 투사체 (구)
      // 초기 색상: 비활성화 상태 (파란색)
      let color = 0x4444ff; // 비활성화: 파란색
      const geometry = new THREE.SphereGeometry(this.radius, 16, 16);

      const material = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: 0.5
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.position);
      return mesh;
    } else {
      // 기본 박스 (fallback)
      const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.5 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.position);
      return mesh;
    }
  }

  isInSector(targetPos) {
    const toTarget = targetPos.clone().sub(this.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist > this.radius) {
      
      return false;
    }

    const dirToTarget = toTarget.normalize();
    const dot = this.direction.dot(dirToTarget);
    const theta = Math.acos(Math.min(Math.max(dot, -1), 1));
    return theta <= this.angle / 2;
  }

  update(delta, targets) {
    if (this.isDestroyed) return;

    // 경과 시간 업데이트
    this.elapsedTime += delta;

    // 활성화 윈도우 체크 (여러 번 활성화/비활성화 지원)
    let wasActive = this.isActive;
    this.isActive = false; // 기본적으로 비활성화

    for (let i = 0; i < this.activationWindows.length; i++) {
      const window = this.activationWindows[i];
      if (this.elapsedTime >= window.start && this.elapsedTime <= window.end) {
        this.isActive = true;
        break;
      }
    }

    // 활성화 상태가 변경되면 색상 업데이트
    if (this.debugMesh && this.debugMesh.material && wasActive !== this.isActive) {
      if (this.isActive) {
        // 활성화: 빨간색
        this.debugMesh.material.color.setHex(0xff0000);
        this.debugMesh.material.opacity = 0.8;
      } else {
        // 비활성화: 파란색
        this.debugMesh.material.color.setHex(0x4444ff);
        this.debugMesh.material.opacity = 0.5;
      }
    }

    // 디버그 메시 위치 및 회전 업데이트
    if (this.debugMesh) {
      this.debugMesh.position.copy(this.position);

      // sector 타입일 경우 방향도 업데이트
      if (this.type === 'sector' || this.type === 'aerial') {
        const angle = Math.atan2(this.direction.x, this.direction.z);
        this.debugMesh.rotation.y = angle;
      }
    }

    if (this.type === 'sector' || this.type === 'aerial') {
      // 판정 활성화 상태일 때만 충돌 검사 (sector 타입)
      if (this.isActive) {
        for (const target of targets) {
          if (target === this.attacker) continue;

          const targetMesh = target.mesh_ || target.model_;
          if (targetMesh && typeof target.TakeDamage === 'function') {
            const canTargetTakeDamage = typeof target.canTakeDamage === 'function' ? target.canTakeDamage() : !target.isDead_;
            if (canTargetTakeDamage && !this.hitTargets.has(target)) {
              const targetPos = targetMesh.position;
              if (this.isInSector(targetPos)) {
                target.TakeDamage(this.weapon.damage);
                this.hitTargets.add(target);
                if (this.attacker && this.attacker.hitEnemies_) { this.attacker.hitEnemies_.add(target); }
                if (this.onHit) this.onHit(target);
                if (this.weapon.projectileEffect !== 'piercing') {
                  // this.destroy();
                }
              }
            }
          }
        }
      }
      // lifeTime 체크는 elapsedTime으로 통일
      if (this.elapsedTime >= this.lifeTime) {
        this.destroy();
        return;
      }
    }

    if (this.type === 'circle') {
      const moveDist = this.speed * delta;
      this.position.addScaledVector(this.direction, moveDist);
      this.traveled += moveDist;
    }

    // lifeTime 초과 시 제거
    if (this.elapsedTime >= this.lifeTime) {
      this.destroy();
      return;
    }

    // 판정 활성화 상태일 때만 충돌 검사 (circle 타입)
    if (this.isActive) {
      for (const target of targets) {
        if (target === this.attacker) continue;

        const targetMesh = target.mesh_ || target.model_;
        if (targetMesh && typeof target.TakeDamage === 'function') {
          const canTargetTakeDamage = typeof target.canTakeDamage === 'function' ? target.canTakeDamage() : !target.isDead_;
          if (canTargetTakeDamage && !this.hitTargets.has(target)) {
            const targetPos = targetMesh.position;
            let hit = false;
            if (this.type === 'circle') {
              const dist = this.position.distanceTo(targetPos);
              const targetRadius = (target.boundingBox_ ? target.boundingBox_.getSize(new THREE.Vector3()).length() / 2 : 0.7);
              hit = dist <= this.radius + targetRadius;
            }

            if (hit) {
              this.hitTargets.add(target);
              if (this.projectileEffect === 'piercing') {
                target.TakeDamage(this.weapon.damage);
                if (this.attacker && this.attacker.hitEnemies_) { this.attacker.hitEnemies_.add(target); }
                if (this.onHit) this.onHit(target);
              } else if (this.projectileEffect === 'explosion') {
                target.TakeDamage(this.weapon.damage);
                if (this.attacker && this.attacker.hitEnemies_) { this.attacker.hitEnemies_.add(target); }
                if (this.onHit) this.onHit(target);
                this.explode(targets);
                this.destroy();
                return;
              } else {
                target.TakeDamage(this.weapon.damage);
                if (this.attacker && this.attacker.hitEnemies_) { this.attacker.hitEnemies_.add(target); }
                if (this.onHit) this.onHit(target);
                this.destroy();
                return;
              }
            }
          }
        }
      } // for 루프 종료
    } // isActive 체크 종료 (circle)

    if (this.traveled >= this.range) {
      this.destroy();
    }
  }

  explode(targets) {
    const explosionRadius = this.radius * 2;
    for (const target of targets) {
      if (target === this.attacker) continue;

      const targetMesh = target.mesh_ || target.model_;
      if (targetMesh && typeof target.TakeDamage === 'function') {
        const canTargetTakeDamage = typeof target.canTakeDamage === 'function' ? target.canTakeDamage() : !target.isDead_;
        if (canTargetTakeDamage && !this.hitTargets.has(target)) {
          const dist = this.position.distanceTo(targetMesh.position);
          if (dist <= explosionRadius) {
            target.TakeDamage(this.weapon.damage * 0.5);
            this.hitTargets.add(target);
          }
        }
      }
    }
  }

  destroy() {
    if (!this.isDestroyed) {
      if (this.debugMesh && this.scene) {
        this.scene.remove(this.debugMesh);
        this.debugMesh = null;
      }
      this.isDestroyed = true;
    }
  }
}