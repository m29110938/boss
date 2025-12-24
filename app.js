// app.js
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();

// subscribers 存檔路徑（簡單檔案儲存）
const SUB_FILE = path.join(__dirname, "subscribers.json");
let subscribers = [];

// 讀取已訂閱者（啟動時）
function loadSubscribers() {
    try {
        if (fs.existsSync(SUB_FILE)) {
            subscribers = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
            if (!Array.isArray(subscribers)) subscribers = [];
        } else {
            subscribers = [];
        }
    } catch (err) {
        console.error("讀取 subscribers.json 錯誤", err);
        subscribers = [];
    }
}
function saveSubscribers() {
    try {
        fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2));
    } catch (err) {
        console.error("寫入 subscribers.json 錯誤", err);
    }
}
loadSubscribers();

// LINE webhook endpoint
app.post("/webhook", line.middleware(config), (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// event handler
async function handleEvent(event) {
    try {
        // 當有人追蹤（加入好友）或解除封鎖時，會收到 follow 事件 -> 存 userId
        if (event.type === "follow") {
            const userId = event.source.userId;
            if (!subscribers.includes(userId)) {
                subscribers.push(userId);
                saveSubscribers();
                console.log("加入訂閱:", userId);
            }
            // 也可以回一個歡迎訊息
            return client.replyMessage(event.replyToken, {
                type: "text",
                text: "謝謝您加入！之後每天早上會收到「老闆在嗎？」",
            });
        }

        // 當收到使用者傳來文字（包含 Quick Reply 按鈕送出的文字）
        if (event.type === "message" && event.message.type === "text") {
            const userId = event.source.userId;
            // 若新用戶直接傳訊也視為訂閱（選擇性）
            if (userId && !subscribers.includes(userId)) {
                subscribers.push(userId);
                saveSubscribers();
                console.log("加入訂閱(訊息觸發):", userId);
            }

            const text = event.message.text.trim();
            // 如果是「在」或「不在」，可以記錄或回覆確認
            if (text === "在" || text === "不在") {
                // 這裡示範回覆一個確認訊息
                return client.replyMessage(event.replyToken, {
                    type: "text",
                    text: `已收到回覆：${text}（謝謝）`,
                });
            }

            // 其他文字（一般處理）
            return client.replyMessage(event.replyToken, {
                type: "text",
                text: `你說：${text}`,
            });
        }

        // 其餘事件不回應（或視需求處理）
        return Promise.resolve(null);
    } catch (err) {
        console.error("handleEvent error:", err);
        return Promise.resolve(null);
    }
}

// 每天早上 09:00（Asia/Taipei 時區）發送「老闆在嗎？」
// cron 排程：分 時 日 月 週 -> '0 9 * * *' = 09:00 每天
// node-cron 支援 timezone 選項
cron.schedule(
    "*/1 * * * *",
    // "0 9 * * *",
    async () => {
        console.log(
            "排程觸發: 發送「老闆在嗎？」給全部訂閱者",
            new Date().toLocaleString()
        );
        const message = {
            type: "text",
            text: "老闆在嗎？",
            quickReply: {
                items: [
                    {
                        type: "action",
                        action: { type: "message", label: "在", text: "在" },
                    },
                    {
                        type: "action",
                        action: {
                            type: "message",
                            label: "不在",
                            text: "不在",
                        },
                    },
                ],
            },
        };

        console.log('訂閱者清單:', subscribers);

        for (const userId of subscribers.slice()) {
            try {
                await client.pushMessage(userId, message);
                console.log("已推送給", userId);
            } catch (err) {
                console.error("推送失敗 userId=", userId, err);
                // 如果推送失敗（例如被封鎖）可考慮從 subscribers 移除
                // 範例：若錯誤顯示 403 或 410，可移除
                // 這邊示範如果是 403/410 就移除
                if (
                    err &&
                    err.statusCode &&
                    (err.statusCode === 403 || err.statusCode === 410)
                ) {
                    const idx = subscribers.indexOf(userId);
                    if (idx !== -1) {
                        subscribers.splice(idx, 1);
                        saveSubscribers();
                        console.log("移除失效訂閱者", userId);
                    }
                }
            }
        }
    },
    { timezone: "Asia/Taipei" }
);

// 啟動 server
app.get("/", (req, res) => res.send("LINE bot is running"));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
