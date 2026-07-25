import type { ScreenFlowDocument } from "./types";

/** 初回起動時に表示するサンプル */
export const sampleDocument: ScreenFlowDocument = {
  version: 1,
  screens: [
    {
      id: "login",
      name: "ログイン",
      url: "/login",
      description: "メールアドレスとパスワードでログイン",
    },
    {
      id: "home",
      name: "ホーム",
      url: "/",
      description: "ダッシュボード",
    },
    {
      id: "settings",
      name: "設定",
      url: "/settings",
      description: "プロフィール・通知設定",
    },
  ],
  transitions: [
    {
      id: "t-login-home",
      source: "login",
      target: "home",
      trigger: {
        type: "submit",
        selector: "form#login",
        label: "ログインボタン",
      },
    },
    {
      id: "t-home-settings",
      source: "home",
      target: "settings",
      trigger: {
        type: "click",
        selector: "a[href='/settings']",
        label: "設定リンク",
      },
    },
    {
      id: "t-settings-home",
      source: "settings",
      target: "home",
      trigger: {
        type: "click",
        selector: "a.back",
        label: "戻る",
      },
    },
  ],
};
