app.post('/', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      throw new Error('No se recibió mensaje en el webhook.');
    }

    console.log("Mensaje recibido:", message);

    let side, symbol, price;
    if (message.includes('BUY')) {
      side = 'BUY';
      const matches = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
      if (!matches) throw new Error('Formato BUY no reconocido.');
      [, symbol, price] = matches;
    } else if (message.includes('SELL')) {
      side = 'SELL';
      const matches = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
      if (!matches) throw new Error('Formato SELL no reconocido.');
      [, symbol, price] = matches;
    } else {
      throw new Error('Mensaje no contiene BUY ni SELL.');
    }

    symbol = symbol.replace('PERP', '');
    price = parseFloat(price);

    // Monto fijo de 200 USDT
    const orderUSDT = 200;
    let quantity = (orderUSDT / price);

    // Ajustar decimales dependiendo del par
    if (symbol.endsWith('USDT')) {
      quantity = quantity.toFixed(3); // 3 decimales
    } else {
      quantity = quantity.toFixed(0); // entero
    }

    // Mostrar IP pública (opcional)
    const publicIP = await getPublicIP();
    if (publicIP) {
      await sendTelegram(`🌐 IP pública del servidor: ${publicIP}`);
    }

    // Consultar posición actual
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide);
      }
    }

    // Asegurar leverage correcto
    await setLeverage(symbol, 3);

    // Crear nueva orden
    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    await sendTelegram(`🚀 Nueva operación ejecutada:

- Tipo: ${side}
- Símbolo: ${symbol}
- Precio Aproximado: $${price}
- Cantidad: ${quantity}
- Order ID: ${orderResult.orderId}`);

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.message)}`);
    res.status(500).send('❌ Error interno.');
  }
});
