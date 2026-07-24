# Use official Node.js lightweight image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package manifest files
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy application source files
COPY . .

# Expose port 5000 for web service router
EXPOSE 5000

# Set environment to production
ENV NODE_ENV=production

# Command to launch Express API server
CMD ["node", "server.js"]
