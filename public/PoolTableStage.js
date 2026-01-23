import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { player } from './player.js';
import { hp } from './hp.js';

/**
 * PoolTableStage 클래스
 * 당구대 맵 전용 게임 스테이지
 */
export class PoolTableStage {
  constructor(socket, players, map, spawnedWeapons) {
    this.socket = socket;
    this.players = {};
    this.localPlayerId = socket.id;
    this.playerInfo = players;
    this.map = map;
    this.spawnedWeapons = spawnedWeapons;
    
    // 당구대 관련 변수
    this.tableModel = null;
    this.mainTableSurface = null;
    this.mainTopY = 0;
    
    // 물리 엔진
    this.physicsWorld = null;
    this.physicsTimeStep = 1 / 60;
    
    // 당구공 배열
    this.poolBalls = [];
    this.ballBodies = [];
    
    // 플레이어
    this.player = null;
    this.playerBody = null;
    this.playerPrevPosition = new THREE.Vector3();
    
    // 카메라 설정
    this.cameraTargetOffset = new THREE.Vector3(0, 15, 10);
    this.rotationAngle = 4.715;
    
    // 충돌 감지
    this.damageTimer = 0;
    this.damageInterval = 0.5;
    this.damageAmount = 10;
    
    // 구멍 리스폰 쿨다운
    this.holeRespawnCooldown = 0;
    this.holeRespawnCooldownTime = 1.0; // 1초 쿨다운
    
    // HP 시스템
    this.hp_ = null;
    
    this.Initialize();
    this.RAF();
  }

  Initialize() {
    console.log('🎱 PoolTableStage 초기화 시작...');
    
    // 렌더러 설정
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.gammaFactor = 2.2;
    
    const container = document.getElementById('container');
    if (container) {
      container.appendChild(this.renderer.domElement);
    }

    // 카메라 설정
    const fov = 60;
    const aspect = window.innerWidth / window.innerHeight;
    const near = 1.0;
    const far = 2000.0;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.position.set(-8, 6, 12);
    this.camera.lookAt(0, 2, 0);

    // 씬 설정
    this.scene = new THREE.Scene();
    
    // 조명 설정
    this.SetupLighting();
    
    // 스카이박스와 안개
    this.SetupSkyAndFog();
    
    // 물리 엔진 초기화
    this.InitializePhysicsWorld();
    
    // 바닥 생성 (배경용)
    this.CreateGround();
    
    // 당구대 로드
    this.LoadPoolTable();
    
    // HP 시스템 초기화
    this.hp_ = new hp.HPUI(this.scene, this.renderer, 'Player');
    
    // 윈도우 리사이즈 이벤트
    window.addEventListener('resize', () => this.OnWindowResize(), false);
  }

  InitializePhysicsWorld() {
    this.physicsWorld = new CANNON.World();
    this.physicsWorld.gravity.set(0, -9.82, 0);
    
    // 물리 재질 설정
    const defaultMaterial = new CANNON.Material('default');
    const tableMaterial = new CANNON.Material('table');
    const ballMaterial = new CANNON.Material('ball');
    
    // 당구대와 공 사이의 접촉 재질
    const tableBallContact = new CANNON.ContactMaterial(tableMaterial, ballMaterial, {
      friction: 0.1,
      restitution: 0.8,
    });
    
    // 공과 공 사이의 접촉 재질
    const ballBallContact = new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
      friction: 0.05,
      restitution: 0.95,
    });
    
    this.physicsWorld.addContactMaterial(tableBallContact);
    this.physicsWorld.addContactMaterial(ballBallContact);
    
    this.tableMaterial = tableMaterial;
    this.ballMaterial = ballMaterial;
    
    console.log('✅ 물리 월드 초기화 완료');
  }

  SetupLighting() {
    // 디렉셔널 라이트
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(60, 100, 10);
    directionalLight.target.position.set(0, 0, 0);
    directionalLight.castShadow = true;
    directionalLight.shadow.bias = -0.0001;
    directionalLight.shadow.normalBias = 0.02;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 1.0;
    directionalLight.shadow.camera.far = 200.0;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    this.scene.add(directionalLight);
    this.scene.add(directionalLight.target);

    // 반구 조명
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0xf6f47f, 0.6);
    this.scene.add(hemisphereLight);
  }

  SetupSkyAndFog() {
    const skyUniforms = {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x89b2eb) },
      offset: { value: 33 },
      exponent: { value: 0.6 }
    };

    const skyGeometry = new THREE.SphereGeometry(1000, 32, 15);
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize( vWorldPosition + offset ).y;
          gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h, 0.0), exponent ), 0.0 ) ), 1.0 );
        }`,
      side: THREE.BackSide,
    });

    const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(skyMesh);
    this.scene.fog = new THREE.FogExp2(0x89b2eb, 0.002);
  }

  CreateGround() {
    // 당구대 주변 바닥 (단순한 색상)
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444, // 회색 바닥
      side: THREE.DoubleSide
    });
    const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -10.0;
    groundPlane.receiveShadow = true;
    this.scene.add(groundPlane);
  }

  LoadPoolTable() {
    console.log('🎱 코드로 당구대 생성 시작...');
    
    // 당구대 그룹 생성
    this.tableModel = new THREE.Group();
    
    // 당구대 상판 생성 (녹색)
    const tableGeometry = new THREE.BoxGeometry(25, 0.5, 50);
    const tableMaterial = new THREE.MeshStandardMaterial({
      color: 0x00AA00,
      metalness: 0.1,
      roughness: 0.6
    });
    const tableTop = new THREE.Mesh(tableGeometry, tableMaterial);
    tableTop.position.set(0, 0, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableTop.name = 'main'; // main 오브젝트로 설정
    this.tableModel.add(tableTop);
    
    // 당구대 상판 높이 설정
    this.mainTopY = tableTop.position.y + 0.25; // 상판 높이
    this.mainTableSurface = tableTop;
    
    // 당구대 테두리 생성 (갈색) - 구멍 좌표를 반영하여 분할 생성
    const borderMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      metalness: 0.2,
      roughness: 0.8
    });

    // (테두리 분할 생성은 구멍 좌표를 만든 뒤 호출합니다.)
    
    // 당구대 다리 생성 (4개)
    const legGeometry = new THREE.CylinderGeometry(0.5, 0.5, 3, 8);
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x654321,
      metalness: 0.1,
      roughness: 0.9
    });
    
    const legPositions = [
      [-10, -1.5, -20],
      [10, -1.5, -20],
      [-10, -1.5, 20],
      [10, -1.5, 20]
    ];
    
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(pos[0], pos[1], pos[2]);
      leg.castShadow = true;
      leg.receiveShadow = true;
      this.tableModel.add(leg);
    });
    
    // 홀 생성 (8개 구멍 - 실제 당구대처럼, 크기 키움)
    const holeGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16);
    const holeMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      metalness: 0.1,
      roughness: 0.9
    });
    
    const holePositions = [
      [-12, 0.25, -25], // 좌상단
      [0, 0.25, -25],   // 상단 중앙
      [12, 0.25, -25],  // 우상단
      [-12.5, 0.25, 0], // 좌측 중앙 (가로축 중간)
      [12.5, 0.25, 0],  // 우측 중앙 (가로축 중간)
      [-12, 0.25, 25],  // 좌하단
      [0, 0.25, 25],    // 하단 중앙
      [12, 0.25, 25]    // 우하단
    ];
    
    // 홀 위치를 클래스 변수에 저장 (충돌 체크용)
    this.holePositions = holePositions;

    holePositions.forEach((pos, index) => {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      hole.position.set(pos[0], pos[1], pos[2]);
      hole.name = `hole${index + 1}`;
      hole.castShadow = true;
      hole.receiveShadow = true;
      this.tableModel.add(hole);
    });

    // 구멍 좌표를 반영하여 분할된 테두리(구멍 제외)를 생성
    this.CreateBordersWithGaps();
    
    this.scene.add(this.tableModel);
    
    // 상판의 바운딩 박스 생성
    const mainBox = new THREE.Box3().setFromObject(tableTop);
    console.log('=== 당구대 상판 정보 ===');
    console.log('상판 높이 (mainTopY):', this.mainTopY);
    console.log('상판 범위:', mainBox);
    
    // 물리 바디 생성
    this.CreateTablePhysics(mainBox);
    
    // 테두리 물리 바디는 CreateBordersWithGaps()에서 이미 생성됩니다.
    
    console.log('✅ 당구대 생성 완료');
    
    // 플레이어 생성
    this.CreatePlayer();
    
    // 당구공 생성
    this.CreatePoolBalls(mainBox);
  }

  CreateTablePhysics(mainBox) {
    // 당구대 상판의 물리 바디 생성
    const size = new THREE.Vector3();
    mainBox.getSize(size);
    const center = new THREE.Vector3();
    mainBox.getCenter(center);
    
    const tableShape = new CANNON.Box(new CANNON.Vec3(size.x / 2, 0.1, size.z / 2));
    const tableBody = new CANNON.Body({
      mass: 0,
      shape: tableShape,
      material: this.tableMaterial,
      position: new CANNON.Vec3(center.x, this.mainTopY, center.z)
    });
    
    this.physicsWorld.addBody(tableBody);
    console.log('✅ 당구대 상판 물리 바디 생성');
  }

  CreateBorderPhysics(borderBox, borderMesh) {
    // 테두리의 물리 바디 생성
    const size = new THREE.Vector3();
    borderBox.getSize(size);
    const center = new THREE.Vector3();
    borderBox.getCenter(center);
    
    const borderShape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const borderBody = new CANNON.Body({
      mass: 0,
      shape: borderShape,
      material: this.tableMaterial,
      position: new CANNON.Vec3(center.x, center.y, center.z)
    });
    
    this.physicsWorld.addBody(borderBody);
  }

  // 구멍 좌표를 반영해 테두리를 분할 생성합니다.
  CreateBordersWithGaps() {
    if (!this.mainTableSurface) {
      console.warn('⚠️ mainTableSurface가 없음 - 분할 테두리 생성 중단');
      return;
    }

    const mainBox = new THREE.Box3().setFromObject(this.mainTableSurface);
    const size = new THREE.Vector3();
    mainBox.getSize(size);
    const halfW = size.x / 2;
    const halfD = size.z / 2;

    // 설정값: 플레이어가 점프로 넘을 수 있는 높이(테두리 높이), 공이 통과하지 못하도록 충분한 두께
    const borderHeight = Math.max(0.8, 1.0); // 필요시 조정
    const borderThickness = Math.max(1.2, 1.0);
    const holeRadius = 1.5; // 프로시저 홀 반경 (원래 사용 값)
    const gapMargin = 0.6; // 홀 주변 여유

    const centerY = this.mainTopY + borderHeight / 2 + 0.05;

    // 헬퍼: 세그먼트 생성 (가로/세로 구분)
    const createSegment = (length, px, py, pz, alongX) => {
      if (length <= 0.1) return null;
      const geom = alongX ? new THREE.BoxGeometry(length, borderHeight, borderThickness)
                           : new THREE.BoxGeometry(borderThickness, borderHeight, length);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.tableModel.add(mesh);

      // 물리 바디
      const box = new THREE.Box3().setFromObject(mesh);
      this.CreateBorderPhysics(box, mesh);
      return mesh;
    };

    // 변별: 상(top, z = -halfD), 하(bottom, z = +halfD), 좌(left, x=-halfW), 우(right, x=+halfW)
    const holes = (this.holePositions || []).map(h => ({ x: h[0], z: h[2] }));

    // TOP (z = -halfD)
    const topHolesX = holes.filter(h => Math.abs(h.z + halfD) < holeRadius + gapMargin).map(h => h.x).sort((a,b)=>a-b);
    let segStart = -halfW;
    for (let i=0;i<=topHolesX.length;i++){
      const holeX = (i<topHolesX.length) ? topHolesX[i] : halfW;
      const left = segStart;
      const right = holeX - (holeRadius + gapMargin);
      const len = right - left;
      if (len>0.05) {
        const cx = (left + right)/2;
        const zPos = -halfD - borderThickness/2;
        createSegment(len, cx, centerY, zPos, true);
      }
      segStart = holeX + (holeRadius + gapMargin);
    }

    // BOTTOM (z = +halfD)
    const bottomHolesX = holes.filter(h => Math.abs(h.z - halfD) < holeRadius + gapMargin).map(h => h.x).sort((a,b)=>a-b);
    segStart = -halfW;
    for (let i=0;i<=bottomHolesX.length;i++){
      const holeX = (i<bottomHolesX.length) ? bottomHolesX[i] : halfW;
      const left = segStart;
      const right = holeX - (holeRadius + gapMargin);
      const len = right - left;
      if (len>0.05){
        const cx = (left + right)/2;
        const zPos = halfD + borderThickness/2;
        createSegment(len, cx, centerY, zPos, true);
      }
      segStart = holeX + (holeRadius + gapMargin);
    }

    // LEFT (x = -halfW)
    const leftHolesZ = holes.filter(h => Math.abs(h.x + halfW) < holeRadius + gapMargin).map(h => h.z).sort((a,b)=>a-b);
    segStart = -halfD;
    for (let i=0;i<=leftHolesZ.length;i++){
      const holeZ = (i<leftHolesZ.length) ? leftHolesZ[i] : halfD;
      const left = segStart;
      const right = holeZ - (holeRadius + gapMargin);
      const len = right - left;
      if (len>0.05){
        const cz = (left + right)/2;
        const xPos = -halfW - borderThickness/2;
        createSegment(len, xPos, centerY, cz, false);
      }
      segStart = holeZ + (holeRadius + gapMargin);
    }

    // RIGHT (x = +halfW)
    const rightHolesZ = holes.filter(h => Math.abs(h.x - halfW) < holeRadius + gapMargin).map(h => h.z).sort((a,b)=>a-b);
    segStart = -halfD;
    for (let i=0;i<=rightHolesZ.length;i++){
      const holeZ = (i<rightHolesZ.length) ? rightHolesZ[i] : halfD;
      const left = segStart;
      const right = holeZ - (holeRadius + gapMargin);
      const len = right - left;
      if (len>0.05){
        const cz = (left + right)/2;
        const xPos = halfW + borderThickness/2;
        createSegment(len, xPos, centerY, cz, false);
      }
      segStart = holeZ + (holeRadius + gapMargin);
    }

    console.log('✅ 분할된 테두리 생성 완료 (구멍 제외)');
  }

  CreatePoolBalls(mainBox) {
    // 당구공 색상 정의
    const ballColors = [
      0xFFFF00, // 노랑
      0x0000FF, // 파랑
      0xFF0000, // 빨강
      0x000000, // 검정
      0xFF8800, // 주황
      0x00FF00, // 초록
    ];
    
    const ballRadius = 0.5;
    const ballY = this.mainTopY + ballRadius + 0.1;
    
    for (let i = 0; i < 6; i++) {
      // 랜덤 위치 생성 (당구대 범위 내)
      const padding = 2;
      const randomX = mainBox.min.x + padding + Math.random() * (mainBox.max.x - mainBox.min.x - padding * 2);
      const randomZ = mainBox.min.z + padding + Math.random() * (mainBox.max.z - mainBox.min.z - padding * 2);
      
      // 공 메시 생성
      const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
      const ballMaterial = new THREE.MeshStandardMaterial({
        color: ballColors[i],
        metalness: 0.3,
        roughness: 0.4
      });
      const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
      ballMesh.position.set(randomX, ballY, randomZ);
      ballMesh.castShadow = true;
      ballMesh.receiveShadow = true;
      this.scene.add(ballMesh);
      
      // 공 물리 바디 생성
      const ballShape = new CANNON.Sphere(ballRadius);
      const ballBody = new CANNON.Body({
        mass: 1,
        shape: ballShape,
        material: this.ballMaterial,
        position: new CANNON.Vec3(randomX, ballY, randomZ),
        linearDamping: 0.3,
        angularDamping: 0.3,
      });
      
      // 랜덤 초기 속도 부여
      const initialSpeed = 3 + Math.random() * 2;
      const randomAngle = Math.random() * Math.PI * 2;
      ballBody.velocity.set(
        Math.cos(randomAngle) * initialSpeed,
        0,
        Math.sin(randomAngle) * initialSpeed
      );
      
      this.physicsWorld.addBody(ballBody);
      
      this.poolBalls.push({
        mesh: ballMesh,
        body: ballBody,
        radius: ballRadius
      });
      
      console.log(`✅ 당구공 ${i + 1} 생성 완료`);
    }
  }

  CreatePlayer() {
    const playerY = this.mainTopY + 1; // 당구대 위에 고정
    
    this.player = new player.Player({
      scene: this.scene,
      position: new THREE.Vector3(0, playerY, 0),
      mainTopY: this.mainTopY,
    });

    // 플레이어 물리 바디 생성
    const playerRadius = 0.8;
    const playerShape = new CANNON.Sphere(playerRadius);
    this.playerBody = new CANNON.Body({
      mass: 0,
      shape: playerShape,
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, playerY, 0)
    });
    
    this.physicsWorld.addBody(this.playerBody);
    this.playerPrevPosition.set(0, playerY, 0);
    
    // HP UI를 플레이어에 연결
    if (this.player.mesh_ && this.hp_) {
      // 플레이어의 머리 본 찾기 (있는 경우)
      let headBone = null;
      this.player.mesh_.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes('head')) {
          headBone = child;
        }
      });
      this.hp_.setPlayerTarget(this.player.mesh_, headBone);
    }
    
    console.log('✅ 플레이어 생성 완료 (Y:', playerY, ')');
  }

  OnWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  RAF(time) {
    requestAnimationFrame((t) => this.RAF(t));

    if (!this.prevTime) this.prevTime = time || performance.now();
    const delta = ((time || performance.now()) - this.prevTime) * 0.001;
    this.prevTime = time || performance.now();

    this.Update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  Update(delta) {
    if (!this.player || !this.player.mesh_) return;
    
    // 플레이어 업데이트
    this.player.Update(delta, this.rotationAngle, [], [], 1);
    
    // 당구대 위 고정: Y 좌표를 강제로 유지
    if (this.player.mesh_) {
      this.player.mesh_.position.y = this.mainTopY + 1; // 당구대 위 약간 위에 고정
    }
    
    // 플레이어 물리 바디 위치 동기화
    if (this.playerBody) {
      const currentPos = this.player.mesh_.position;
      
      this.playerBody.position.set(currentPos.x, currentPos.y, currentPos.z);
      this.playerBody.velocity.y = 0; // Y축 속도 초기화 (중력 방지)
      
      // 속도 계산
      const velocityX = (currentPos.x - this.playerPrevPosition.x) / delta;
      const velocityY = (currentPos.y - this.playerPrevPosition.y) / delta;
      const velocityZ = (currentPos.z - this.playerPrevPosition.z) / delta;
      
      this.playerBody.velocity.set(velocityX, velocityY, velocityZ);
      this.playerPrevPosition.copy(currentPos);
    }
    
    // 물리 월드 업데이트
    if (this.physicsWorld) {
      this.physicsWorld.step(this.physicsTimeStep);
    }
    
    // 당구공 위치 동기화 및 충돌 체크
    for (let i = 0; i < this.poolBalls.length; i++) {
      const ball = this.poolBalls[i];
      
      // 물리 바디 위치를 메시에 반영
      ball.mesh.position.copy(ball.body.position);
      ball.mesh.quaternion.copy(ball.body.quaternion);
      
      // 플레이어와 공의 충돌 체크
      if (this.player.mesh_) {
        const ballPos = ball.mesh.position;
        const playerPos = this.player.mesh_.position;
        const distance = ballPos.distanceTo(playerPos);
        const collisionDistance = ball.radius + 0.8;
        
        if (distance < collisionDistance) {
          // 충돌 발생
          this.damageTimer += delta;
          if (this.damageTimer >= this.damageInterval) {
            if (this.hp_) {
              this.hp_.updateHP(Math.max(0, this.hp_.hp - this.damageAmount));
              console.log(`💥 당구공에 맞음! -${this.damageAmount} HP`);
            }
            this.damageTimer = 0;
            
            // 플레이어를 튕겨냄
            const pushDirection = new THREE.Vector3()
              .subVectors(playerPos, ballPos)
              .normalize();
            const pushForce = 5;
            
            // 플레이어 위치 조정 (밀어냄)
            this.player.mesh_.position.add(
              pushDirection.multiplyScalar(pushForce * delta)
            );
          }
        }
      }
    }
    
    // 구멍 충돌 체크 (플레이어가 구멍에 빠지면 중앙 리스폰)
    this.CheckHoleCollisions(delta);
    
    // 맵 경계 체크
    this.CheckMapBounds();
    
    // 카메라 업데이트
    this.UpdateCamera();
  }

  UpdateCamera() {
    if (!this.player || !this.player.mesh_) return;

    const target = this.player.mesh_.position.clone();
    const offset = this.cameraTargetOffset.clone();
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotationAngle);
    const cameraPos = target.clone().add(offset);
    this.camera.position.copy(cameraPos);

    const headOffset = new THREE.Vector3(0, 2, 0);
    const headPosition = target.clone().add(headOffset);
    this.camera.lookAt(headPosition);
  }

  CheckHoleCollisions(delta) {
    if (!this.player || !this.player.mesh_ || !this.holePositions) return;
    
    // 쿨다운 중에는 체크하지 않음
    if (this.holeRespawnCooldown > 0) {
      this.holeRespawnCooldown -= delta;
      return;
    }
    
    const playerPos = this.player.mesh_.position;
    const holeRadius = 1.5; // 구멍 반경
    
    for (const holePos of this.holePositions) {
      const holePosition = new THREE.Vector3(holePos[0], holePos[1], holePos[2]);
      const distance = playerPos.distanceTo(holePosition);
      
      // 플레이어가 구멍 영역 내에 들어오면 중앙 리스폰
      if (distance < holeRadius) {
        // 당구대 중앙으로 리스폰
        const respawnY = this.mainTopY + 1; // 당구대 위에 고정
        this.player.mesh_.position.set(0, respawnY, 0);
        
        // 물리 바디도 함께 이동
        if (this.playerBody) {
          this.playerBody.position.set(0, respawnY, 0);
          this.playerBody.velocity.set(0, 0, 0); // 속도 초기화
        }
        
        // 쿨다운 설정
        this.holeRespawnCooldown = this.holeRespawnCooldownTime;
        
        console.log('🕳️ 구멍에 빠짐! 중앙으로 리스폰');
        break; // 한 번에 하나의 구멍에만 빠질 수 있음
      }
    }
  }

  CheckMapBounds() {
    if (!this.player || !this.player.mesh_) return;
    
    const playerPos = this.player.mesh_.position;
    
    // Y 위치가 너무 낮으면 리스폰
    if (playerPos.y < this.mainTopY - 5) {
      playerPos.set(0, this.mainTopY + 1, 0); // 당구대 위로 리스폰
      if (this.hp_) {
        this.hp_.updateHP(Math.max(0, this.hp_.hp - 20));
        console.log('🔄 플레이어 리스폰 (낙하) -20 HP');
      }
    }
  }

  Cleanup() {
    // 리소스 정리
    if (this.tableModel) {
      this.scene.remove(this.tableModel);
    }
    
    for (const ball of this.poolBalls) {
      this.scene.remove(ball.mesh);
      this.physicsWorld.removeBody(ball.body);
    }
    
    if (this.playerBody) {
      this.physicsWorld.removeBody(this.playerBody);
    }
    
    if (this.hp_) {
      this.hp_.Destroy();
    }
    
    console.log('🧹 PoolTableStage 정리 완료');
  }
}
