FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN mkdir -p public/css public/html public/js && \
    touch public/css/styles.css \
          public/js/scripts.js \
          public/html/index.html \
          public/html/users.html \
          public/html/deals.html \
          public/html/referrals.html \
          public/html/broadcasts.html \
          public/html/analytics.html \
          public/html/login.html

RUN npm install -g concurrently

EXPOSE 3000

CMD ["concurrently", "npm:start_main_bot", "npm:start_spam_bot", "npm:start_web"]