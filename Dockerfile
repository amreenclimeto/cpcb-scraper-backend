FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

# Install Playwright runtime dependencies and Chromium browser.
RUN npx -y playwright@1.58.2 install --with-deps chromium

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start"]
