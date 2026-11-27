import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { autoQaApi } from './server/api';

// 로컬 PC 전용 (D-041): 회사 TC·화면 자료는 이 PC 밖으로 나가지 않는다 → localhost에만 연다
export default defineConfig({
	plugins: [react(), autoQaApi()],
	server: { host: '127.0.0.1', port: 8093, strictPort: true }
});
