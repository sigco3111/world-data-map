/**
 * 파비콘 생성 스크립트
 * 기본 파비콘 파일들을 생성합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES 모듈에서 __dirname 사용하기 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 경로 설정
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(rootDir, 'public');

/**
 * 메인 함수 - 필요한 파비콘 파일 생성
 */
function generateFavicons() {
  console.log('파비콘 생성 시작...');
  
  // 디렉토리 확인
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  // favicon.svg 파일 생성 (브라우저 호환성 향상)
  const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg 
  xmlns="http://www.w3.org/2000/svg" 
  viewBox="0 0 100 100" 
  width="100" 
  height="100">
  <!-- 지구본 배경 -->
  <circle cx="50" cy="50" r="45" fill="#2563eb" stroke="#1d4ed8" stroke-width="2"/>
  
  <!-- 경도선 -->
  <path d="M50,5 A45,45 0 0,1 50,95 A45,45 0 0,1 50,5" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.5"/>
  <path d="M5,50 A45,45 0 0,1 95,50 A45,45 0 0,1 5,50" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.5"/>
  
  <!-- 간단한 대륙 모양 -->
  <path d="M30,30 Q40,20 50,35 T70,40 Q80,50 60,70 T30,60 Q20,40 30,30" fill="#10b981" stroke="#059669" stroke-width="1"/>
</svg>`;
  
  fs.writeFileSync(path.resolve(publicDir, 'favicon.svg'), svgContent);
  console.log('✅ favicon.svg 생성 완료');
  
  // favicon.ico 파일 (1x1 투명 픽셀)
  // 이진 데이터로 직접 생성
  const icoData = Buffer.from([
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x0A, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x00
  ]);
  
  fs.writeFileSync(path.resolve(publicDir, 'favicon.ico'), icoData);
  console.log('✅ favicon.ico 생성 완료');
  
  // apple-touch-icon.png (1x1 투명 픽셀)
  // 이 파일은 웹 브라우저가 로드하지만 실제로는 favicon.svg를 사용할 것입니다
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82
  ]);
  
  fs.writeFileSync(path.resolve(publicDir, 'apple-touch-icon.png'), pngData);
  console.log('✅ apple-touch-icon.png 생성 완료');
  
  console.log('🎉 모든 파비콘 생성이 완료되었습니다!');
}

// 스크립트 실행
generateFavicons(); 