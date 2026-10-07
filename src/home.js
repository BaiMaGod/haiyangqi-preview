import { createDebugRankProfile, getRankById, getRankFromProfile, getRankProgress, normalizeRankProfile } from './rank.js?v=ai-explore-20261006-1';
import { SPECIES } from './game.js?v=ai-explore-20261006-1';

const RANK_STORAGE_KEY = 'haiyangqi.rank.v1';
const PREFERENCES_KEY = 'haiyangqi.home.preferences.v1';
const home = document.querySelector('#home-screen');
const rankName = document.querySelector('#home-rank-name');
const rankPoints = document.querySelector('#home-rank-points');
const rankProgress = document.querySelector('#home-rank-progress');
const rankTrack = document.querySelector('#home-rank-track');
const toast = document.querySelector('#home-toast');
const settingsDialog = document.querySelector('#home-settings-dialog');
const galleryDialog = document.querySelector('#home-gallery-dialog');
const infoDialog = document.querySelector('#home-info-dialog');
const animationToggle = document.querySelector('#home-animation-toggle');
let toastTimer;
let entering = false;

function readProfile() {
  let profile;
  try {
    const raw = localStorage.getItem(RANK_STORAGE_KEY);
    profile = normalizeRankProfile(raw ? JSON.parse(raw) : {});
  } catch {
    profile = normalizeRankProfile({});
  }
  const params = new URLSearchParams(window.location.search);
  const debug = params.has('debug') && !['0', 'false', 'off', 'no'].includes((params.get('debug') || '1').toLowerCase());
  if (debug) {
    const requested = Number.parseInt(params.get('rank'), 10);
    return createDebugRankProfile(getRankById(Number.isFinite(requested) ? requested : getRankFromProfile(profile).id).id);
  }
  return profile;
}

function refreshRank() {
  const profile = readProfile();
  const rank = getRankFromProfile(profile);
  const progress = getRankProgress(profile);
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent * 100)));
  const compact = (value) => value >= 10000 ? (value / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(value);
  rankName.textContent = rank.name;
  rankPoints.textContent = progress.isPeak ? '巅峰' : compact(progress.current) + ' / ' + compact(progress.max);
  rankProgress.style.width = percent + '%';
  rankTrack.setAttribute('aria-valuenow', String(percent));
  rankTrack.setAttribute('aria-valuetext', progress.isPeak ? rank.name + '，巅峰胜点 ' + progress.current : rank.name + '，' + progress.current + ' / ' + progress.max + ' 胜点');
  document.querySelector('#home-profile').title = rankTrack.getAttribute('aria-valuetext');
}

function readPreferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
    return { animations: raw?.animations !== false };
  } catch {
    return { animations: true };
  }
}

function applyPreferences(preferences) {
  document.body.classList.toggle('home-reduced-motion', !preferences.animations);
  animationToggle.checked = preferences.animations;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2300);
}

function enterGame() {
  if (entering) return;
  entering = true;
  home.classList.add('leaving');
  const reduceMotion = document.body.classList.contains('home-reduced-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    document.body.classList.remove('home-active');
    home.hidden = true;
    home.classList.remove('leaving');
    window.dispatchEvent(new Event('haiyangqi:resume'));
    entering = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector('#board button')?.focus({ preventScroll: true });
  }, reduceMotion ? 0 : 230);
}

function showHome() {
  if (entering) return;
  const event = new Event('haiyangqi:pause', { cancelable: true });
  if (!window.dispatchEvent(event)) return;
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  const inProgress = Number(document.querySelector('#move-count').textContent) > 0 && !document.querySelector('#result-overlay').classList.contains('show');
  document.querySelector('#home-resume-hint').hidden = !inProgress;
  document.querySelector('#home-start').title = inProgress ? '继续当前对局' : '开始游戏';
  document.body.classList.add('home-active');
  home.hidden = false;
  home.scrollTop = 0;
  refreshRank();
  document.querySelector('#home-start').focus({ preventScroll: true });
}

function showSettings() {
  applyPreferences(readPreferences());
  settingsDialog.showModal();
}

const info = {
  daily: ['每日奖励', '每日奖励即将开放。现在可以体验排位对战、教学和海洋生物图鉴。'],
  activity: ['活动中心', '海洋活动即将开放。当前排位模式已开放，挑战与你同段位的 AI，赢棋积累胜点。'],
  missions: ['新手任务', '新手任务即将开放。你可以先查看教学，了解首翻定阵营、大吃小与藤壶克制虎鲸的规则。'],
  treasure: ['深海寻宝', '深海寻宝即将开放。先在排位中熟悉每种海洋生物，准备下一次海底冒险。'],
  event: ['限时活动', '当前没有开放的限时活动。新的海洋挑战上线后会在这里展示。'],
  duo: ['双人对战', '双人对战即将开放。当前支持与同段位 AI 对战，可通过开始游戏或排位模式进入。'],
};

function showInfo(key) {
  const content = info[key];
  if (!content) return;
  document.querySelector('#home-info-title').textContent = content[0];
  document.querySelector('#home-info-description').textContent = content[1];
  infoDialog.showModal();
}

document.querySelector('#home-start').addEventListener('click', enterGame);
document.querySelector('#home-ranked').addEventListener('click', enterGame);
document.querySelector('#home-return').addEventListener('click', showHome);
document.querySelector('#result-home').addEventListener('click', showHome);
document.querySelector('#home-profile').addEventListener('click', () => document.querySelector('#rank-button').click());
document.querySelector('#home-tutorial').addEventListener('click', () => document.querySelector('#rules-button').click());
document.querySelector('#home-gallery').addEventListener('click', () => galleryDialog.showModal());
document.querySelector('#home-duo').addEventListener('click', () => showInfo('duo'));
document.querySelector('#home-mail').addEventListener('click', () => showToast('暂时没有新的海洋来信'));
document.querySelector('#home-settings').addEventListener('click', showSettings);
document.querySelector('#home-settings-secondary').addEventListener('click', showSettings);
document.querySelectorAll('[data-home-add]').forEach((button) => button.addEventListener('click', () => showToast('贝壳与珍珠即将开放')));
document.querySelectorAll('[data-home-info]').forEach((button) => button.addEventListener('click', () => showInfo(button.dataset.homeInfo)));
document.querySelector('#home-info-play').addEventListener('click', () => { infoDialog.close(); enterGame(); });
document.querySelectorAll('.home-dialog').forEach((dialog) => {
  dialog.querySelector('[data-home-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
});
animationToggle.addEventListener('change', () => {
  const preferences = { animations: animationToggle.checked };
  applyPreferences(preferences);
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    showToast('设置已应用，但当前浏览器无法保存');
  }
});
document.querySelector('#home-gallery-list').innerHTML = [...SPECIES].reverse().map((species) =>
  '<article class="home-gallery-species"><img src="' + species.art + '" alt="" loading="lazy" decoding="async"><b>' + species.name + '</b><small>' + species.rank + '级</small></article>'
).join('');
window.addEventListener('pageshow', refreshRank);
window.addEventListener('haiyangqi:rank-change', refreshRank);
window.addEventListener('storage', (event) => {
  if (event.key === RANK_STORAGE_KEY) refreshRank();
  if (event.key === PREFERENCES_KEY) applyPreferences(readPreferences());
});
applyPreferences(readPreferences());
refreshRank();
