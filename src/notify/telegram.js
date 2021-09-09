const axios = require("axios").default;

async function trySendMessage(botToken, chatId, text){
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId,
            parse_mode: "HTML",
            text
        })
    } catch (e) {
        return;
    }
}

module.exports = {
    trySendMessage
}