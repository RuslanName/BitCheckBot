FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN mkdir -p public/css public/html public/js public/images database && \
    touch public/css/styles.css \
          public/html/index.html \
          public/html/users.html \
          public/html/deals.html \
          public/html/referrals.html \
          public/html/broadcasts.html \
          public/html/analytics.html \
          public/html/login.html \
          public/js/scripts.js \
          public/images/bit-check-image.png \
          database/config.json \
          database/deals.json \
          database/broadcasts.json \
          database/users.json \
          database/withdrawals.json \
          database/states.json

RUN npm install -g concurrently

EXPOSE 3000

CMD ["concurrently", "npm:start_main_bot", "npm:start_spam_bot", "npm:start_web"]