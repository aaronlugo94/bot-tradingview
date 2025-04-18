app.post('/', async (req, res) => {
  const { message } = req.body;
  console.log("📨 Mensaje recibido:", message);

  if (!message) {
    return res.status(400).send('Mensaje no recibido');
  }

  // Extraer los valores del mensaje JSON
  const symbol = message.symbol;    // Ejemplo: "BTCUSDT"
  const price = message.price;      // Ejemplo: 84746.17
  const timeframe = message.timeframe; // Ejemplo: "1m"
  const side = message.side.toUpperCase(); // Ejemplo: "BUY" o "SELL"
  
  // Verificar que se recibió una señal de compra o venta
  if (side !== 'BUY' && side !== 'SELL') {
    return res.status(400).send('Señal no válida, debe ser BUY o SELL');
  }

  const quantityUSD = 1000;
  const quantity = (quantityUSD / parseFloat(price)).toFixed(6); // Calcular cantidad de contrato

  // Crear el mensaje para Telegram con el nuevo formato
  const telegramMessage = `📡 Señal recibida de TradingView:\n\n` +
    `${side === 'BUY' ? '🟢' : '🔴'} ${side} - ${symbol} a ${price}\n\n` +
    `📈 Ejecutando orden:\n` +
    `- Tipo: ${side === 'BUY' ? 'Buy' : 'Sell'}\n` +
    `- Símbolo: ${symbol}\n` +
    `- Precio: $${price}\n` +
    `- Cantidad: ${quantity} (${quantityUSD} USDT)`;

  // Enviar el mensaje a Telegram
  await sendTelegramMessage(telegramMessage);

  // Enviar la orden a Bybit
  await sendBybitOrder(symbol, side, quantity);

  res.send("Mensaje procesado");
});
