import type { ExportedFrame, ExportedNode } from '@auto-qa/figma';
import { IMAGE, node, resetIds, solid, text } from '@auto-qa/figma/testing';

/**
 * 테스트용 합성 화면설계서 페이지. 실제 화면설계서와 같은 틀(헤더·버전 이력·진입 조건·1200×675 목업·
 * 번호 마커·오른쪽 설명·추가 설명·Audio Guidance·쪽 번호·경계 밖 메모)이지만 내용은 지어낸 것이다.
 */

const YELLOW = { r: 1, g: 0.75, b: 0, a: 1 };

/** 원 + 번호 묶음 */
export function marker(no: string, x: number, y: number, grouped = true): ExportedNode[] {
	const circle = node(
		'ELLIPSE',
		{ x, y, width: 43, height: 43 },
		{ fills: [solid(0, 0, 0)], strokes: [solid(1, 0.75, 0)] }
	);
	const label = text(no, { x: x + 15, y: y + 11, width: 12, height: 23 }, { size: 20, color: YELLOW });
	return grouped ? [node('GROUP', { x, y, width: 43, height: 43 }, { children: [circle, label] })] : [circle, label];
}

const t = (characters: string, x: number, y: number, width: number, height: number, size = 20): ExportedNode =>
	text(characters, { x, y, width, height }, { size });

export function sampleSpecPage(): ExportedFrame {
	resetIds(1000);
	const mockup: ExportedNode[] = [
		node(
			'RECTANGLE',
			{ x: 39, y: 187, width: 1200, height: 675 },
			{ name: 'Rectangle 944', fills: [solid(0.25, 0.25, 0.25)] }
		),
		node(
			'GROUP',
			{ x: 341, y: 213, width: 596, height: 45 },
			{
				children: [
					node('RECTANGLE', { x: 341, y: 213, width: 596, height: 45 }, { fills: [solid(0.2, 0.2, 0.2)] }),
					t('Search here', 385, 226, 218, 21)
				]
			}
		),
		t('Popular', 170, 298, 120, 30),
		node('RECTANGLE', { x: 170, y: 341, width: 200, height: 41 }, { fills: [solid(0.2, 0.2, 0.2)] }),
		node('RECTANGLE', { x: 39, y: 539, width: 1199, height: 52 }, { fills: [solid(0.26, 0.3, 0.32)] }),
		node(
			'VECTOR',
			{ x: 36, y: 531, width: 1205, height: 68 },
			{ name: 'Rectangle 1020', strokes: [solid(1, 0.75, 0)], strokeWeight: 2 }
		),
		node(
			'GROUP',
			{ x: 700, y: 600, width: 539, height: 140 },
			{
				name: 'keyboard',
				children: [
					node(
						'RECTANGLE',
						{ x: 700, y: 600, width: 539, height: 140 },
						{ fills: [solid(0.23, 0.25, 0.27)] }
					),
					node('RECTANGLE', { x: 940, y: 612, width: 122, height: 38 }, { fills: [solid(0.3, 0.3, 0.3)] })
				]
			}
		),
		node(
			'GROUP',
			{ x: 1179, y: 217, width: 39, height: 39 },
			{
				name: 'Group 48100810',
				children: [node('RECTANGLE', { x: 1179, y: 217, width: 39, height: 39 }, { fills: [IMAGE] })]
			}
		),
		t('Trending', 170, 747, 205, 30),
		node('RECTANGLE', { x: 169, y: 799, width: 133, height: 63 }, { fills: [solid(0.2, 0.2, 0.2)] })
	];
	const markers = [
		...marker('1', 292, 211),
		...marker('2', 115, 299),
		...marker('3', 536, 544),
		...marker('4', 1102, 613),
		...marker('5', 1134, 222),
		...marker('6', 115, 752, false)
	];
	const descriptions = [
		...marker('1', 1279, 118),
		t(
			'Search 영역\n_검색어를 입력하는 칸\n1)표시 내용\n플레이스홀더 제공\n2)포커스 된 상태에서 4way key 입력 시\n[▲]: 동작 없음\n[▼]: 아래 첫 항목으로 이동\n이동한 이력이 있을 경우: 마지막 포커스 항목\n[︎►]: 메뉴로 이동',
			1335,
			119,
			560,
			240
		),
		...marker('2', 1279, 427),
		t('Popular 영역\n1)표시 내용\n추천 키워드 최대 5개', 1335, 428, 560, 72),
		...marker('3', 1279, 560),
		t('강조 영역\n_입력값에 따른 제안', 1335, 561, 560, 48),
		...marker('4', 1279, 640),
		t('Keyboard(가상 키보드)\n_키보드 정책을 따름', 1335, 641, 560, 48),
		...marker('5', 1168, 869),
		t('설정 버튼\n2)선택 시\n설정 팝업 호출\n[OK]: 팝업 열기\n[Back]: 닫기', 1224, 870, 600, 120)
	];
	const header = [
		node('LINE', { x: 0, y: 116, width: 1920, height: 0 }, { strokes: [solid(0, 0, 0)] }),
		t('Sample', 46, 9, 92, 23),
		t('2.1. 샘플 목록', 54, 37, 300, 23),
		t('2.1.1. 샘플 화면 - 진입 시', 49, 63, 700, 44, 37),
		node('RECTANGLE', { x: 1092, y: 1, width: 826, height: 112 }, { fills: [solid(0.85, 0.85, 0.85)] }),
		t('[v1.0.1]\n첫 정의', 1189, 11, 242, 42, 18),
		t('[v2.0.0]\n문구 변경\n[v1.10.0]\n간격 조정', 1431, 11, 430, 84, 18),
		t('M', 1879, 17, 21, 28, 24)
	];
	const rest = [
		t('샘플 페이지 진입 시 화면(Default Focus: 첫 번째 카드)', 44, 138, 1192, 24),
		t('[추가 설명]\n재진입 시 마지막 위치 유지', 35, 901, 534, 66),
		node(
			'GROUP',
			{ x: 26, y: 1021, width: 996, height: 120 },
			{
				children: [
					node('RECTANGLE', { x: 26, y: 1021, width: 996, height: 120 }, { fills: [solid(1, 0.76, 0)] }),
					t('Audio Guidance\n진입 시\n🔊 <"Search">', 62, 1038, 960, 80)
				]
			}
		),
		{ ...t('42', 1857, 1387, 31, 21, 18), name: 'PageNumberText' },
		t('디자이너 메모', 1335, 5435, 404, 31, 18)
	];
	return {
		pageId: '0:3',
		pageName: 'UX',
		image: null,
		node: node(
			'FRAME',
			{ x: 2000, y: 600, width: 1920, height: 1440 },
			{
				name: '2. Sample',
				id: '8:spec',
				clipsContent: true,
				fills: [solid(1, 1, 1)],
				children: [...header, ...rest, ...mockup, ...markers, ...descriptions].map((n) => offset(n, 2000, 600))
			}
		)
	};
}

/** 위 좌표는 프레임 기준으로 적었으므로 캔버스 위치로 옮긴다 */
function offset(n: ExportedNode, dx: number, dy: number): ExportedNode {
	return {
		...n,
		box: n.box === null ? null : { ...n.box, x: n.box.x + dx, y: n.box.y + dy },
		renderBox: n.renderBox === null ? null : { ...n.renderBox, x: n.renderBox.x + dx, y: n.renderBox.y + dy },
		children: n.children.map((c) => offset(c, dx, dy))
	};
}

/**
 * 위 화면설계서(2.1.1 샘플 화면)에 대응하는 합성 GUI 프레임 (1920×1080).
 * - keyboard: 화면설계서와 같은 상태 (강조 줄 + 오른쪽 키보드). "Popular" 대신 "Popular Now"로 글자가 다르다
 * - closed: 같은 화면의 키보드 닫힌 변형 (강조 줄·키보드 없음)
 */
export function sampleGuiFrame(variant: 'keyboard' | 'closed', id = `8:gui-${variant}`): ExportedFrame {
	resetIds(variant === 'keyboard' ? 2000 : 3000);
	const dark = solid(0.15, 0.15, 0.15);
	const children: ExportedNode[] = [
		node(
			'FRAME',
			{ x: 480, y: 40, width: 960, height: 72 },
			{ name: 'search form', fills: [dark], children: [t('Search here', 530, 60, 300, 32, 24)] }
		),
		node(
			'FRAME',
			{ x: 1830, y: 60, width: 48, height: 48 },
			{
				name: 'btn_setting',
				children: [
					node('VECTOR', { x: 1840, y: 70, width: 28, height: 28 }, { name: 'icon', fills: [solid(1, 1, 1)] })
				]
			}
		),
		t('Popular Now', 210, 180, 220, 40, 28),
		node(
			'FRAME',
			{ x: 210, y: 240, width: 900, height: 60 },
			{ name: 'chips', children: [t('Walking', 230, 255, 120, 30), t('Driving', 400, 255, 120, 30)] }
		),
		t('Trending', 210, 896, 200, 40, 28),
		node('FRAME', { x: 210, y: 950, width: 600, height: 100 }, { name: 'cards', fills: [IMAGE] })
	];
	if (variant === 'keyboard') {
		children.push(
			node(
				'FRAME',
				{ x: 0, y: 560, width: 1920, height: 90 },
				{ name: 'strip', fills: [dark], children: [t('sample keyword', 300, 590, 200, 30)] }
			),
			node(
				'FRAME',
				{ x: 1050, y: 655, width: 870, height: 230 },
				{
					name: 'keyboard',
					fills: [dark],
					children: [
						node(
							'RECTANGLE',
							{ x: 1080, y: 670, width: 120, height: 60 },
							{ fills: [solid(0.3, 0.3, 0.3)] }
						),
						node(
							'RECTANGLE',
							{ x: 1220, y: 670, width: 120, height: 60 },
							{ fills: [solid(0.3, 0.3, 0.3)] }
						)
					]
				}
			)
		);
	}
	const name = variant === 'keyboard' ? '2.1.1 Sample_샘플 화면 진입' : '2.1.1 Sample_샘플 화면 키보드 닫힘';
	return {
		pageId: '0:4',
		pageName: 'GUI',
		image: null,
		node: node(
			'FRAME',
			{ x: 8000, y: 0, width: 1920, height: 1080 },
			{
				name,
				id,
				clipsContent: true,
				fills: [solid(0, 0, 0)],
				children: children.map((n) => offset(n, 8000, 0))
			}
		)
	};
}
