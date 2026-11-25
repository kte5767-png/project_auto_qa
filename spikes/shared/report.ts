import { matchesTruth } from '@auto-qa/sample-tv-app/truth';
import type { FocusAdapterId } from '@auto-qa/focus';
import { ADAPTERS } from './focusRun';
import type { FocusRunResult } from './focusRun';

const COLORS: Record<FocusAdapterId, string> = {
	'enact-spotlight': '#00c853',
	'active-element': '#2979ff',
	selector: '#ff9100',
	'style-diff': '#d500f9'
};

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/**
 * 측정 리포트 (HTML). 스크린샷 위에 어댑터별 판단 상자를 그린다.
 * 정답이 없는 실제 앱은 사람이 단계마다 "맞음/틀림"을 눈으로 확인한다.
 */
export function renderFocusReport(title: string, results: FocusRunResult[]): string {
	const sections = results.map((r) => {
		const summary = ADAPTERS.map((a) => {
			const acc = r.accuracy[a];
			const agr = r.agreement[a];
			if (acc === undefined && agr === undefined && r.steps[0]?.readings.some((x) => x.adapter === a) !== true)
				return '';
			const accText =
				acc === undefined ? '-' : `${acc.hits}/${acc.total} (${Math.round((acc.hits / acc.total) * 100)}%)`;
			const agrText = agr === undefined ? '-' : `${Math.round(agr * 100)}%`;
			return `<tr><td><span class="sw" style="background:${COLORS[a]}"></span>${a}</td><td>${accText}</td><td>${agrText}</td></tr>`;
		}).join('');
		const meta = Object.entries(r.meta)
			.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`)
			.join('');
		const cands = r.candidates
			.map(
				(c) =>
					`<li><b>${c.adapter}${c.selector === undefined ? '' : ` ${escapeHtml(c.selector)}`}</b> ${Math.round(c.confidence * 100)}% — ${escapeHtml(c.evidence)}</li>`
			)
			.join('');
		const steps = r.steps
			.map((s) => {
				const boxes = s.readings
					.filter((x) => x.element !== null)
					.map((x) => {
						const [left, top, width, height] = x.element?.rect ?? [0, 0, 0, 0];
						return `<div class="box" title="${x.adapter}" style="left:${left / 2}px;top:${top / 2}px;width:${width / 2}px;height:${height / 2}px;border-color:${COLORS[x.adapter]}"></div>`;
					})
					.join('');
				const lines = s.readings
					.map((x) => {
						const ok = s.truth === null ? '' : matchesTruth(x.path, s.truth) ? ' ✓' : ' ✗';
						const label =
							x.element === null
								? '없음'
								: escapeHtml(x.element.spotlightId ?? x.element.text ?? x.element.tag);
						return `<div style="color:${COLORS[x.adapter]}">${x.adapter}: ${label}${ok}</div>`;
					})
					.join('');
				const press =
					s.press === null
						? ''
						: ` · 키 ${s.press.delivered === null ? '확인 불가(시스템 키)' : s.press.delivered ? `도착 ${s.press.latencyMs}ms` : '<b style="color:#d50000">도착 안 함</b>'}`;
				const stable = `${s.stable ? '' : '<b style="color:#d50000">안정화 시간 초과</b> '}${s.waitedMs}ms${s.stableMode === 'legacy' ? ' (구형 엔진 방식)' : ''}`;
				const judge =
					s.index === 0
						? ''
						: '<label class="judge"><input type="checkbox" class="wrong"> 사람 확인: 1순위 판단이 틀림</label>';
				return `<div class="step"><div class="shot"><img src="${s.screenshot}" width="960" height="540">${boxes}</div><div class="meta"><b>#${s.index} ${s.key}</b> ${stable}${press}${lines}${judge}</div></div>`;
			})
			.join('');
		const scored = r.steps.length - 1;
		return `<section data-total="${scored}"><h2>${escapeHtml(r.name)} <small>${escapeHtml(r.description)}</small></h2>
<ul>${meta}</ul>
<h3>자동 탐지 후보</h3><ol>${cands}</ol>
<h3>어댑터별 결과</h3><table><tr><th>어댑터</th><th>정확도(정답 대비)</th><th>1순위 후보와 일치율</th></tr>${summary}</table>
<p class="manual">사람 확인 정확도: <b>${scored}/${scored} (100%)</b> — 틀린 단계에 표시하면 바로 계산됩니다</p>
${steps}</section>`;
	});
	return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.sw{display:inline-block;width:12px;height:12px;margin-right:6px}.step{display:flex;gap:16px;margin:12px 0}.shot{position:relative;width:960px;height:540px;flex:none;background:#111}.box{position:absolute;border:3px solid;box-sizing:border-box}.meta{font-size:13px}.judge{display:block;margin-top:8px;color:#555}</style>
<h1>${escapeHtml(title)}</h1><p>상자 색: ${ADAPTERS.map((a) => `<span class="sw" style="background:${COLORS[a]}"></span>${a}`).join(' ')}</p>
<p>정답이 없는 앱은 단계마다 스크린샷의 실제 포커스와 1순위 어댑터 상자를 비교해 "틀림"에 표시해 주세요. 정확도 = (키 입력 수 − 틀림) ÷ 키 입력 수.</p>${sections.join('<hr>')}
<script>
document.addEventListener('change', function (e) {
	var section = e.target.closest('section');
	if (section === null) return;
	var total = Number(section.getAttribute('data-total'));
	var wrong = section.querySelectorAll('input.wrong:checked').length;
	var ok = total - wrong;
	section.querySelector('.manual b').textContent = ok + '/' + total + ' (' + Math.round((ok / Math.max(total, 1)) * 100) + '%)';
});
</script>`;
}
