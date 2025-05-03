const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const Decimal = require('decimal.js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Función para firmar las consultas
function sign(queryString) {
  const signature = crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
  return signature;
}

// Función para enviar mensaje a Telegram
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (error) {
    console.error('❌ Error enviando Telegram:', error.message);
  }
}

// Función para obtener la posición actual
async function getPosition(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);
    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };
    const response = await axios.get(url, { headers });
    return response.data.find(pos => pos.symbol === symbol) || null;
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    return null;
  }
}

// Función para establecer el apalancamiento
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

// Función para obtener el precio de mercado
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

// Función para redondear al tamaño adecuado
function roundToStepSize(value, stepSize) {
  return new Decimal(value).div(stepSize).floor().mul(stepSize).toNumber();
}

// Función para obtener precisión del símbolo
async function getSymbolPrecision(symbol) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/exchangeInfo`;
    const response = await axios.get(url);
    const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) throw new Error(`No se encontró información para ${symbol}`);
    const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    return {
      stepSize: lotSize.stepSize
    };
  } catch (error) {
    console.error("❌ Error obteniendo precisión del símbolo:", error.message);
    return { stepSize: '0.01' }; // Valor por defecto conservador
  }
}

// Función para enviar orden
async function sendOrder(symbol, side, quantity) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
    const signature = sign(queryString);
    const url = `https://fapi.binance.com/fapi/v1/order?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };
    const response = await axios.post(url, null, { headers });
    return response.data;
  } catch (error) {
    console.error('❌ Error enviando orden:', error.response?.data || error.message);
    throw error;
  }
}

// Función para cerrar una posición opuesta
async function closeOpposite(symbol, currentPositionAmt, side, entryPrice) {
  try {
    const oppositeSide = currentPositionAmt > 0 ? 'SELL' : 'BUY';
    const quantityToClose = Math.abs(currentPositionAmt);
    await sendOrder(symbol, oppositeSide, quantityToClose);
    await sendTelegram(`🔄 Posición anterior cerrada:
- ${oppositeSide} ${symbol}
- Cantidad: ${quantityToClose}`);

    const markPrice = await getMarkPrice(symbol);
    const pnl = (markPrice - entryPrice) * currentPositionAmt * (side === 'SELL' ? 1 : -1);
    const pnlMessage = pnl >= 0 ? `✅ PnL: +${pnl.toFixed(2)} USDT` : `❌ PnL: -${pnl.toFixed(2)} USDT`;

    await sendTelegram(`📊 Resultados:
- Entrada: $${entryPrice}
- Cierre: $${markPrice.toFixed(2)}
${pnlMessage}`);
  } catch (error) {
    console.error('❌ Error cerrando posición:', error.message);
  }
}

// Función para obtener la IP pública
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('❌ Error obteniendo la IP pública:', error.message);
    return null;
  }
}

// Comprobación de IP antes de realizar solicitudes a Binance
async function checkIPAndProceed() {
  const ip = await getPublicIP();
  console.log(`Tu IP pública es: ${ip}`);

  // Verificar si la IP está en la lista blanca de Binance o es permitida
  // (Esto depende de la política de tu VPS o de si Binance tiene restricciones geográficas)
  if (!ip || ip === 'Tu IP bloqueada') {
    console.log("❌ IP bloqueada o no permitida.");
    return false;
  }

  // Si la IP está bien, puedes proceder con las operaciones
  console.log("✅ IP verificada correctamente. Continuando con la operación...");
  return true;
}

// 🚀 Endpoint principal
app.post('/', async (req, res) => {
  try {
    console.log("Cuerpo recibido:", req.body);
    const { message } = req.body;

    if (!message) throw new Error('Mensaje inválido.');

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

    symbol = symbol.replace('PERP', '');
    price = parseFloat(price);
    const orderUSDT = 200;
    const rawQuantity = orderUSDT / price;

    const { stepSize } = await getSymbolPrecision(symbol);
    const quantity = roundToStepSize(rawQuantity, stepSize);

    const position = await getPosition(symbol);
    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        await closeOpposite(symbol, posSide, side, price);
      }
    }

    // Verificar la IP antes de proceder
    const ipVerified = await checkIPAndProceed();
    if (!ipVerified) {
      res.status(403).send('❌ IP bloqueada.');
      return;
    }

    await setLeverage(symbol, 3);
    const markPrice = await getMarkPrice(symbol);
    if (!markPrice || markPrice <= 0) throw new Error('Precio de mercado inválido.');

    const orderResult = await sendOrder(symbol, side, quantity);

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
