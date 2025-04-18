const axios = require('axios');

// Recupera las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

// Función para enviar mensaje a Telegram
const sendTelegramMessage = async (message) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log('✅ Mensaje enviado a Telegram:', response.data);
  } catch (error) {
    console.error('❌ Error enviando mensaje a Telegram:', error.response ? error.response.data : error.message);
  }
};

// Función para enviar orden a Bybit (testnet)
const sendBybitOrder = async (orderDetails) => {
  try {
    const url = 'https://api-testnet.bybit.com/v2/private/order/create'; // Asegúrate de usar testnet si estás en pruebas
    const params = {
      api_key: BYBIT_API_KEY,
      api_secret: BYBIT_API_SECRET,
      ...orderDetails,
    };

    const response = await axios.post(url, params);
    console.log('✅ Orden enviada a Bybit:', response.data);
  } catch (error) {
    console.error('❌ Error enviando orden a Bybit:', error.response ? error.response.data : error.message);
  }
};

// Aquí es donde recibirás las señales de TradingView
const handleTradingViewSignal = async (signal) => {
  try {
    const message = `¡Nueva señal recibida! ${signal}`;
    await sendTelegramMessage(message);

    // Extraemos la información del mensaje de TradingView
    const regex = /([🔴🟢])\s*(BUY|SELL)\s*-\s*([A-Z]+) a ([\d.]+) en (\d+)/;
    const matches = signal.match(regex);

    if (!matches) {
      console.error('❌ No se pudo extraer símbolo o precio del mensaje.');
      return;
    }

    const [, arrow, action, symbol, price, interval] = matches;
    const side = action === 'BUY' ? 'Buy' : 'Sell';
    const qty = 1000; // $1000 en USDT, ajusta si es necesario

    console.log(`📨 Mensaje recibido: ${signal}`);
    console.log(`📉 Procesando orden: ${side} ${symbol} a ${price} en ${interval}`);

    // Detalles de la orden de Bybit
    const orderDetails = {
      side: side,
      symbol: symbol,
      order_type: 'Market',
      qty: qty,
    };

    // Enviar orden a Bybit
    await sendBybitOrder(orderDetails);
  } catch (error) {
    console.error('❌ Error manejando la señal de TradingView:', error);
  }
};

// Exportar la función para que Railway la ejecute
module.exports = async (event) => {
  const signal = event.body.message; // Asegúrate de que el mensaje esté en el formato correcto
  await handleTradingViewSignal(signal);
};
