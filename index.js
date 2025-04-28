const axios = require('axios');
const crypto = require('crypto');

// API Keys
const API_KEY = 'TU_API_KEY';
const API_SECRET = 'TU_API_SECRET';
const TELEGRAM_TOKEN = 'TU_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'TU_TELEGRAM_CHAT_ID';

// Función para firmar las solicitudes
function sign(query) {
  return crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');
}

// Función para enviar mensajes a Telegram
async function sendTelegramMessage(message) {
  const telegramURL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await axios.post(telegramURL, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  });
}

// Función para cerrar posición
async function closePosition(symbol, side) {
  try {
    const timestamp = Date.now();
    const query = `symbol=${symbol}&side=${side}&type=MARKET&quantity=0.002&timestamp=${timestamp}`;
    const signature = sign(query);
    const url = `https://fapi.binance.com/fapi/v1/order?${query}&signature=${signature}`;

    const response = await axios.post(url, null, {
      headers: { 'X-MBX-APIKEY': API_KEY },
    });

    console.log('✅ Posición cerrada:', response.data);
    await sendTelegramMessage(`✅ Cerrada posición ${side === 'BUY' ? 'SHORT' : 'LONG'} en ${symbol}`);
  } catch (error) {
    console.error('❌ Error al cerrar posición:', error.response ? error.response.data : error.message);
    await sendTelegramMessage(`❌ Error al cerrar posición: ${error.message}`);
  }
}

// Función principal para procesar la señal
async function processSignal(symbol, side) {
  try {
    // Primero, verificar las posiciones abiertas
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = sign(query);
    const positionsUrl = `https://fapi.binance.com/fapi/v2/positionRisk?${query}&signature=${signature}`;

    const positionsResponse = await axios.get(positionsUrl, {
      headers: { 'X-MBX-APIKEY': API_KEY },
    });

    const positions = positionsResponse.data;
    const position = positions.find(p => p.symbol === symbol);

    // Si existe posición abierta, revisarla
    if (position && position.positionAmt && parseFloat(position.positionAmt) !== 0) {
      const positionAmt = parseFloat(position.positionAmt);

      if (positionAmt < 0 && side === 'BUY') {
        // Hay un SHORT abierto, cerrar comprando
        await closePosition(symbol, 'BUY');
      } else if (positionAmt > 0 && side === 'SELL') {
        // Hay un LONG abierto, cerrar vendiendo
        await closePosition(symbol, 'SELL');
      }
    }

    // Luego de cerrar posiciones (si existía), abrir nueva orden
    const quantity = 200 / parseFloat(position.markPrice); // 200 USDT
    const formattedQuantity = parseFloat(quantity.toFixed(3)); // Redondear para evitar error de decimales

    const orderQuery = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${formattedQuantity}&timestamp=${Date.now()}`;
    const orderSignature = sign(orderQuery);
    const orderUrl = `https://fapi.binance.com/fapi/v1/order?${orderQuery}&signature=${orderSignature}`;

    const orderResponse = await axios.post(orderUrl, null, {
      headers: { 'X-MBX-APIKEY': API_KEY },
    });

    console.log('✅ Nueva orden enviada:', orderResponse.data);
    await sendTelegramMessage(`✅ Nueva orden ${side} en ${symbol} con ${formattedQuantity} cantidad.`);
  } catch (error) {
    console.error('❌ Error procesando señal:', error.response ? error.response.data : error.message);
    await sendTelegramMessage(`❌ Error procesando señal: ${error.message}`);
  }
}

// Simulación de recepción de señal
// Puedes llamar processSignal('BTCUSDT', 'BUY') o processSignal('BTCUSDT', 'SELL') según el mensaje recibido.

