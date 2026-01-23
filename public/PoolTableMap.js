import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/loaders/GLTFLoader.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { player } from './player.js';

/**
 * PoolTableMap 클래스
 * 당구대 위에서 굴러다니는 당구공을 피하는 맵
 */
export class PoolTableMap {
  constructor(params) {
    this.scene = params.scene;
    this.camera = params.camera;
    this.renderer = params.renderer;
    this.socket = params.socket;
    this.playerInfo = params.playerInfo;
    this.onPlayerDamage = params.onPlayerDamage; // HP 감소 콜백
    
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
    this.damageInterval = 0.5; // 0.5초마다 데미지
    this.damageAmount = 10; // 공에 맞을 때 데미지
    
    this.Initialize();
  }

  Initialize() {
    console.log('🎱 PoolTableMap 초기화 시작...');
    
    // 물리 엔진 초기화
    this.InitializePhysicsWorld();
    
    // 당구대 로드
    this.LoadPoolTable();
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
      restitution: 0.8, // 튕김 정도
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

  LoadPoolTable() {
    const loader = new GLTFLoader();
    
    // pool-table 폴더의 당구대 모델 사용
    loader.load(
      '/resources/Pool-table/tablemap.glb',
      (gltf) => {
        this.tableModel = gltf.scene;
        
        // 당구대 위치 및 스케일 조정
        const box = new THREE.Box3().setFromObject(this.tableModel);
        const minY = box.min.y;
        this.tableModel.position.y = -minY;

        const size = new THREE.Vector3();
        box.getSize(size);
        const scaleX = 25 / size.x;
        const scaleZ = 50 / size.z;
        this.tableModel.scale.set(scaleX, scaleX, scaleZ);
        this.tableModel.updateMatrixWorld(true);

        console.log('=== 당구대 로드 정보 ===');
        console.log('원본 크기:', size);
        console.log('스케일:', scaleX, scaleZ);

        // main 오브젝트 (당구대 상판) 찾기
        const mainObject = this.tableModel.getObjectByName('main');
        if (mainObject) {
          mainObject.updateMatrixWorld(true);
          const mainBox = new THREE.Box3().setFromObject(mainObject);
          this.mainTopY = mainBox.max.y;
          this.mainTableSurface = mainObject;
          
          console.log('=== 당구대 상판 정보 ===');
          console.log('상판 높이 (mainTopY):', this.mainTopY);
          console.log('상판 범위:', mainBox);
          
          // 당구대 상판에 물리 바디 추가
          this.CreateTablePhysics(mainBox);
          
          // 시각적으로 숨김
          mainObject.visible = false;
        }

        // 당구대 테두리 처리
        this.tableModel.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            // box로 시작하는 테두리 오브젝트
            if (child.name && child.name.match(/^box\d+$/)) {
              child.updateWorldMatrix(true, true);
              const childBox = new THREE.Box3().setFromObject(child);
              
              // 테두리에도 물리 바디 추가
              this.CreateBorderPhysics(childBox, child);
              
              // 테두리 색상 변경
              child.traverse((meshChild) => {
                if (meshChild.isMesh) {
                  meshChild.material = new THREE.MeshStandardMaterial({
                    color: 0x8B4513, // 갈색
                    metalness: 0.2,
                    roughness: 0.8
                  });
                }
              });
            }
            
            // 홀 오브젝트 처리
            if (child.name && child.name.includes('hole')) {
              child.material = new THREE.MeshStandardMaterial({ 
                color: 0x000000,
                metalness: 0.1,
                roughness: 0.9
              });
            }
          }
        });

        this.scene.add(this.tableModel);
        console.log('✅ 당구대 로드 완료');
        
        // 플레이어 생성
        this.CreatePlayer();
        
        // 당구공 생성
        if (mainObject) {
          const mainBox = new THREE.Box3().setFromObject(mainObject);
          this.CreatePoolBalls(mainBox);
        }
      },
      undefined,
      (error) => {
        console.error('❌ 당구대 로드 실패:', error);
      }
    );
  }

  CreateTablePhysics(mainBox) {
    // 당구대 상판의 물리 바디 생성
    const size = new THREE.Vector3();
    mainBox.getSize(size);
    const center = new THREE.Vector3();
    mainBox.getCenter(center);
    
    const tableShape = new CANNON.Box(new CANNON.Vec3(size.x / 2, 0.1, size.z / 2));
    const tableBody = new CANNON.Body({
      mass: 0, // 정적 바디
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
      mass: 0, // 정적 바디
      shape: borderShape,
      material: this.tableMaterial,
      position: new CANNON.Vec3(center.x, center.y, center.z)
    });
    
    this.physicsWorld.addBody(borderBody);
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
    const ballY = this.mainTopY + ballRadius + 0.1; // 상판 위에 배치
    
    for (let i = 0; i < 6; i++) {
      // 랜덤 위치 생성 (당구대 범위 내)
      const padding = 2; // 테두리에서 여유 공간
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
        linearDamping: 0.3, // 선형 감쇠 (마찰)
        angularDamping: 0.3, // 각속도 감쇠
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
    const playerY = this.mainTopY + 2; // 당구대 위에 스폰
    
    this.player = new player.Player({
      scene: this.scene,
      position: new THREE.Vector3(0, playerY, 0),
      mainTopY: this.mainTopY,
    });

    // 플레이어 물리 바디 생성
    const playerRadius = 0.8;
    const playerShape = new CANNON.Sphere(playerRadius);
    this.playerBody = new CANNON.Body({
      mass: 0, // Kinematic 바디 (물리적으로 움직이지만 힘을 받지 않음)
      shape: playerShape,
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, playerY, 0)
    });
    
    this.physicsWorld.addBody(this.playerBody);
    this.playerPrevPosition.set(0, playerY, 0);
    
    console.log('✅ 플레이어 생성 완료 (Y:', playerY, ')');
  }

  Update(delta) {
    if (!this.player || !this.player.mesh_) return;
    
    // 플레이어 업데이트
    this.player.Update(delta, this.rotationAngle, [], [], 1);
    
    // 플레이어 물리 바디 위치 동기화
    if (this.playerBody) {
      const currentPos = this.player.mesh_.position;
      
      this.playerBody.position.set(currentPos.x, currentPos.y, currentPos.z);
      
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
      if (this.player.mesh_ && this.player.boundingBox_) {
        const ballPos = ball.mesh.position;
        const playerPos = this.player.mesh_.position;
        const distance = ballPos.distanceTo(playerPos);
        const collisionDistance = ball.radius + 0.8; // 플레이어 반경
        
        if (distance < collisionDistance) {
          // 충돌 발생
          this.damageTimer += delta;
          if (this.damageTimer >= this.damageInterval) {
            if (this.onPlayerDamage) {
              this.onPlayerDamage(this.damageAmount);
              console.log(`💥 당구공에 맞음! -${this.damageAmount} HP`);
            }
            this.damageTimer = 0;
          }
        }
      }
    }
    
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

  // 맵 경계 체크 (당구대에서 떨어지지 않도록)
  CheckMapBounds() {
    if (!this.player || !this.player.mesh_ || !this.mainTableSurface) return;
    
    const playerPos = this.player.mesh_.position;
    
    // Y 위치가 너무 낮으면 리스폰
    if (playerPos.y < this.mainTopY - 5) {
      playerPos.set(0, this.mainTopY + 2, 0);
      console.log('🔄 플레이어 리스폰');
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
    
    console.log('🧹 PoolTableMap 정리 완료');
  }
}
