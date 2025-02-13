import app from './index.js';

const PORT = process.env.PORT || 7665;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});