async function postToServer() {
  const url = 'https://subscrin-server-xdatmpahkf.cn-hangzhou.fcapp.run/'; // 你的FC地址
  const payload = {
    // 根据你的后端接口要求，填充请求体
    key: 'value',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // 假设后端接收 JSON
        // 如果 FC 函数配置了“签名”认证，这里还需要添加签名字段
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json(); // 假设返回 JSON
    console.log('Success:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

// 调用函数
postToServer();