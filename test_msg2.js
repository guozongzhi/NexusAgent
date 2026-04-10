import { render, Text, Box, Static } from 'ink';
import React, { useState, useEffect } from 'react';

function App() {
  const [msgs] = useState([{ role: "user", content: "你真聪明" }]);
  return (
    <Static items={msgs}>
      {(item, i) => {
        const lines = item.content.trimEnd().split('\n');
        return (
          <Box key={i} marginTop={1} flexDirection="column">
            {lines.map((line, idx) => (
              <Text key={idx} backgroundColor="#232323">
                {idx === 0 ? <Text color="magentaBright" bold>{' >  '}</Text> : <Text>{'    '}</Text>}
                <Text color="white">{line + '\x1b[K'}</Text>
              </Text>
            ))}
          </Box>
        );
      }}
    </Static>
  );
}

render(<App />);
