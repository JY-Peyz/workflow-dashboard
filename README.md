# WorkFlow - 업무 종합 대시보드

팀 협업을 위한 올인원 업무 관리 플랫폼입니다.  
업무 배정, 실시간 채팅, 결산 관리, 일정, 팀 현황을 하나의 화면에서 관리할 수 있습니다.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?logo=socket.io&logoColor=white)

---

## 주요 기능

### 업무 관리
- 칸반보드 형식의 업무 관리 (대기 / 진행 중 / 완료)
- 팀장이 업무 생성 및 팀원에게 배정
- 업무 완료 시 팀장 승인 시스템
- 우선순위(높음/보통/낮음) 및 마감일 설정

### 실시간 팀 채팅
- Socket.io 기반 실시간 메시지 송수신
- 카카오톡 스타일 메시지 확인(체크) 기능
- 메시지 삭제 기능 (본인 메시지만)
- 확인한 팀원 목록 조회

### 결산 관리
- 수입/지출 직접 입력 및 엑셀(xlsx) 파일 업로드
- Chart.js 기반 결산 차트 (일간/주간/월간/분기/연간)
- 일일 결산 리포트 이메일 발송 (Gmail SMTP)
- 카테고리별 지출 분석

### 팀 현황
- 팀원별 온라인/오프라인 상태 표시
- 업무 진행률 및 현재 작업 표시
- 팀원 프로필 조회 (이메일, 전화번호, 지역)
- 팀장 권한 부여/해제 기능

### 캘린더
- 월간 달력에 일정 등록 (회의/마감/이벤트)
- 날짜별 업무 할당
- 오늘 일정 하이라이트

### 기타
- Google OAuth 2.0 로그인
- 첫 로그인 시 프로필 설정 안내
- 포스트잇 메모 (컬러별)
- 다크 모드 / 라이트 모드 전환
- AI 어시스턴트 연동 (OpenAI / Claude API, 선택사항)
- 데모 계정으로 즉시 체험 가능

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | HTML, CSS, JavaScript (Vanilla) |
| 백엔드 | Node.js, Express |
| 실시간 통신 | Socket.io |
| 인증 | Passport.js, Google OAuth 2.0 |
| 차트 | Chart.js |
| 메일 | Nodemailer (Gmail SMTP) |
| 엑셀 | xlsx |
| 데이터 저장 | JSON 파일 기반 (data.json) |

---

## 프로젝트 구조

```
dashboard/
├── server.js            # Express 서버, API 엔드포인트, Socket.io
├── db.js                # JSON 파일 기반 데이터베이스
├── package.json         # 의존성 및 스크립트
├── .env.example         # 환경변수 템플릿
├── .gitignore
└── public/
    ├── index.html       # 메인 대시보드
    ├── login.html       # 로그인 페이지
    ├── css/
    │   └── style.css    # 스타일시트
    └── js/
        └── app.js       # 프론트엔드 로직
```

---

## 실행 방법

```bash
# 1. 패키지 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일을 열어 값을 입력합니다

# 3. 서버 실행
npm start
```

브라우저에서 `http://localhost:3000` 에 접속합니다.  
환경변수 없이도 **데모 계정**으로 모든 기능을 체험할 수 있습니다.

---

## 환경변수

| 변수명 | 설명 |
|--------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 클라이언트 시크릿 |
| `SESSION_SECRET` | 세션 암호화 키 |
| `SMTP_USER` | Gmail 주소 (메일 발송용) |
| `SMTP_PASS` | Gmail 앱 비밀번호 |
| `SMTP_HOST` | SMTP 서버 (기본: smtp.gmail.com) |
| `PORT` | 서버 포트 (기본: 3000) |

---

## 역할 시스템

| 역할 | 권한 |
|------|------|
| **팀장** | 업무 생성/삭제/승인, 결산 메일 발송, 팀원 권한 변경 |
| **팀원** | 본인 업무 상태 변경, 결산 입력, 채팅 |

- Google 로그인 시 기본 역할은 **팀원**입니다
- 팀장이 팀원 프로필에서 **"팀장으로 임명"** 버튼으로 권한을 부여할 수 있습니다

---

## 라이선스

학습 및 과제 목적으로 제작되었습니다.
