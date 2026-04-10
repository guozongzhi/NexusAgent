import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static } from 'ink';

function App() {
  const [items, setItems] = useState([1]);
  useEffect(() => {
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }, []);

  return (
    <>
      <Static items={items}>
        {(item, i) => (
          <Box key={i} flexDirection="column" width="100%">
            <Text backgroundColor="#232323">
              <Text color="magentaBright" bold>{' >  '}</Text>
              <Text color="white">{`User says hello\x1b[K`}</Text>
            </Text>
          </Box>
        )}
      </Static>
      <Text>Active area</Text>
    </>
  );
}

render(<App />);
