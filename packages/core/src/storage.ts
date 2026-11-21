/**
 * 스크린샷·트레이스·크롭 이미지 등 바이너리 저장소 인터페이스 (D-016).
 * 기본 구현은 로컬 파일 시스템이며, S3 호환 저장소가 필요하면 어댑터를 추가한다.
 * 구현체는 부수 효과를 가지므로 core가 아닌 별도 패키지에 둔다.
 */
export interface BlobStore {
	/** key 예: `runs/<runId>/screens/<screenId>.png` */
	put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
	/** 없으면 null */
	get(key: string): Promise<Uint8Array | null>;
	/** 없어도 오류 없이 끝난다 */
	delete(key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
}
