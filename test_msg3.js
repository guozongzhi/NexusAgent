import { render, Text, Box, Static } from 'ink';
import React, { useState, useEffect } from 'react';

function App() {
  const [msgs] = useState([{ role: "user", content: "你真聪明" }]);
  return (
    <Static items={msgs}>
      {(item, i) => {
        return (
          <Box key={i} marginTop={1} flexDirection="column">
            <Text backgroundColor="#232323">
              <Text color="magentaBright" bold>{' >  '}</Text>
              <Text color="white">{item.content + '  '}</Text>
            </Text>
          </Box>
        );
      }}
    </Static>
  );
}

render(<App />);
