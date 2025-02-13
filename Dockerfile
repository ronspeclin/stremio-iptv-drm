FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the application
COPY . .

# Expose the port your app runs on
EXPOSE 7665

# Start the application
CMD ["npm", "start"]