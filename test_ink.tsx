import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static } from 'ink';

function App() {
  const [items, setItems] = useState([1]);
  useEffect(() => {
    setTimeout(() => {
      setItems([1, 2]);
    }, 1000);
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  }, []);

  return (
    <>
      <Static items={items}>
        {(item, i) => (
          <Box key={i} flexDirection="column" width="100%">
            {/* Try raw ANSI escape sequences */}
            <Text>{`\x1b[48;2;35;35;35m > Hello User \x1b[K\x1b[0m`}</Text>
          </Box>
        )}
      </Static>
      <Text>Active area</Text>
    </>
  );
}

render(<App />);
