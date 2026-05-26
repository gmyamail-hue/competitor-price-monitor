/**
 * 用 Upstash Redis 保存：监控网址列表、暂停状态、上次运行结果
 */

const { Redis } = require("@upstash/redis");

const STATE_KEY = "monitor:state";

const DEFAULT_STATE = {
  paused: false,
  urls: [],
  lastRunAt: null,
  lastEmailAt: null,
  lastResults: [],
};

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function getState() {
  const redis = getRedis();
  if (!redis) {
    return { ...DEFAULT_STATE, _storageReady: false };
  }
  const data = await redis.get(STATE_KEY);
  const state = data ? { ...DEFAULT_STATE, ...data } : { ...DEFAULT_STATE };
  return { ...state, _storageReady: true };
}

async function setState(state) {
  const redis = getRedis();
  if (!redis) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  const toSave = {
    paused: !!state.paused,
    urls: Array.isArray(state.urls) ? state.urls : [],
    lastRunAt: state.lastRunAt || null,
    lastEmailAt: state.lastEmailAt || null,
    lastResults: Array.isArray(state.lastResults) ? state.lastResults : [],
  };
  await redis.set(STATE_KEY, toSave);
  return toSave;
}

module.exports = { getState, setState, DEFAULT_STATE };
