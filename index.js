const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sign(queryString) {
  const signature = crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
  console.log('Firma generada:', signature);
  return signature;
}

async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log('Respuesta de Telegram:', response.data);
  } catch (error) {
    console.error('❌ Error enviando Telegram:', error.message);
  }
}

async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('❌ Error obteniendo IP:', error.message);
    return null;
  }
}

async function getPosition(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const positions = response.data;

    console.log('Posiciones abiertas:', positions);
    return positions.find(pos => pos.symbol === symbol) || null;
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    return null;
  }
}

async function setLeverage(symbol, leverage = 3) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/leverage?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    await axios.post(url, null, { headers });
  } catch (error) {
    console.error('❌ Error cambiando leverage:', error.response?.data || error.message);
  }
}

async function getMarkPrice(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    return parseFloat(response.data.markPrice);
  } catch (error) {
    console.error('❌ Error obteniendo el precio de mercado:', error.response?.data || error.message);
    return null;
  }
}

async function getSymbolInfo(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/exchangeInfo?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);

    console.log("Información del símbolo:", symbolInfo);
    return symbolInfo;
  } catch (error) {
    console.error('❌ Error obteniendo información del símbolo:', error.response?.data || error.message);
    return null;
  }
}

async function sendOrder(symbol, side, quantity) {
  try {
    const symbolInfo = await getSymbolInfo(symbol);
    const precision = symbolInfo?.quantityPrecision || 0;
    quantity = parseFloat(quantity).toFixed(precision);

    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/order?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.post(url, null, { headers });

    console.log("Respuesta de Binance:", response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error enviando orden:', error.response?.data || error.message);
    throw error;
  }
}

async function closeOpposite(symbol, currentPositionAmt, side, quantity) {
  try {
    const oppositeSide = currentPositionAmt > 0 ? 'SELL' : 'BUY';
    const quantityToClose = Math.abs(currentPositionAmt);

    await sendOrder(symbol, oppositeSide, quantityToClose);
    await sendTelegram(`🔄 Posición anterior cerrada:
- ${oppositeSide} ${symbol}
- Cantidad: ${quantityToClose}
- Entrada: $${quantity}`);

    const markPrice = await getMarkPrice(symbol);
    const pnl = (markPrice - quantity) * currentPositionAmt * (side === 'SELL' ? 1 : -1);
    const pnlMessage = pnl >= 0 ? `✅ PnL: +${pnl.toFixed(2)} USDT` : `❌ PnL: -${pnl.toFixed(2)} USDT`;

    await sendTelegram(`🔄 Posición cerrada con PnL:
- ${side} ${symbol}
- Cantidad: ${quantity}
- Entrada: $${quantity}
- Precio Cierre: $${markPrice.toFixed(2)}
${pnlMessage}`);
  } catch (error) {
    console.error('❌ Error cerrando posición:', error.message);
  }
}

// 🚀 Bot principal
app.post('/', async (req, res) => {
  try {
    console.log("Cuerpo recibido:", req.body);
    const { message } = req.body;

    if (!message) throw new Error('El mensaje recibido es inválido o está vacío.');
    console.log("Mensaje recibido:", message);

    let side, symbol, price;
    if (message.includes('BUY')) {
      side = 'BUY';
      [_, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
    } else if (message.includes('SELL')) {
      side = 'SELL';
      [_, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
    } else {
      throw new Error('Mensaje no reconocido.');
    }

    console.log(`Extracción - Símbolo: ${symbol}, Precio: ${price}`);

    // ✅ LIMPIEZA Y NORMALIZACIÓN DEL SÍMBOLO
    symbol = symbol.replace(/PERP|\.p/gi, '').toUpperCase();
    price = parseFloat(price);

    console.log(`Símbolo procesado: ${symbol}, Precio procesado: ${price}`);

    const orderUSDT = 200;
    let quantity = orderUSDT / price;
    console.log(`Cantidad calculada: ${quantity}`);

    if (symbol.endsWith('USDT')) {
      quantity = quantity.toFixed(3);
    } else {
      quantity = quantity.toFixed(0);
    }

    console.log(`Cantidad ajustada: ${quantity}`);

    const position = await getPosition(symbol);
    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide, side, price);
      }
    }

    await setLeverage(symbol, 3);
    const markPrice = await getMarkPrice(symbol);
    if (!markPrice || markPrice <= 0) throw new Error('No se pudo obtener el precio de mercado.');

    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    await sendTelegram(`🚀 Nueva operación ejecutada:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio Aproximado: $${markPrice.toFixed(2)}
- Cantidad: ${quantity}
- Order ID: ${orderResult.orderId}`);

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(500).send('❌ Error interno.');
  }
});

app.listen(port, () => {
  console.log(`🚀 Bot escuchando en puerto ${port}`);
});
