import { getRankFromProfile, getRankProgress, normalizeRankProfile } from './rank.js?v=ai-explore-20261006-1';

const RANK_STORAGE_KEY = 'haiyangqi.rank.v1';
const home = document.querySelector('#home-screen');
const rankName = document.querySelector('#home-rank-name');
const rankProgress = document.querySelector('#home-rank-progress');
const toast = document.querySelector('#home-toast');
let toastTimer = null;
let entering = false;

function readProfile() {
  try {
    const raw = localStorage.getItem(RANK_STORAGE_KEY);
    return normalizeRankProfile(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeRankProfile({});
  }
}

function refreshRank() {
  const profile = readProfile();
  const rank = getRankFromProfile(profile);
  const progress = getRankProgress(profile);
  rankName.textContent = rank.name;
  rankProgress.style.width = `${Math.max(5, Math.round(progress.percent * 100))}%`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function enterGame(afterEnter) {
  if (entering) return;
  entering = true;
  home.classList.add('leaving');
  window.setTimeout(() => {
    document.body.classList.remove('home-active');
    home.hidden = true;
    home.classList.remove('leaving');
    entering = false;
    afterEnter?.();
  }, 260);
}

function showRules() {
  enterGame(() => {
    window.setTimeout(() => document.querySelector('#rules-button')?.click(), 50);
  });
}

function showGallery() {
  enterGame(() => {
    window.setTimeout(() => {
      document.querySelector('#legend')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  });
}

document.querySelector('#home-start')?.addEventListener('click', () => enterGame());
document.querySelector('#home-ranked')?.addEventListener('click', () => enterGame());
document.querySelector('#home-tutorial')?.addEventListener('click', showRules);
document.querySelector('#home-gallery')?.addEventListener('click', showGallery);
document.querySelector('#home-duo')?.addEventListener('click', () => showToast('双人对战正在开发中，当前先体验 AI 排位模式'));
document.querySelector('#home-mail')?.addEventListener('click', () => showToast('暂时没有新的海洋来信'));
document.querySelector('#home-settings')?.addEventListener('click', () => showToast('进入对局后可通过右上角规则与重开控制游戏'));
document.querySelectorAll('[data-home-add]').forEach((button) => {
  button.addEventListener('click', () => showToast('资源系统将在后续版本开放'));
});

window.addEventListener('pageshow', refreshRank);
refreshRank();
