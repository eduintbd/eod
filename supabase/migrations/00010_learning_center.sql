-- Learning Center tables
-- Supports public course catalog, enrollment, progress tracking, quizzes, and certificates

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'basics',
  level TEXT NOT NULL DEFAULT 'beginner',
  duration_hours NUMERIC NOT NULL DEFAULT 1,
  thumbnail_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'video', 'quiz')),
  content JSONB NOT NULL DEFAULT '{}',
  order_index INT NOT NULL DEFAULT 0,
  duration_minutes INT DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, course_id)
);

CREATE TABLE lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}',
  score NUMERIC NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  certificate_number TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

-- Enable RLS
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Permissive policies (service role key bypasses RLS anyway)
CREATE POLICY "courses_read" ON courses FOR SELECT USING (true);
CREATE POLICY "courses_write" ON courses FOR ALL USING (true);
CREATE POLICY "modules_read" ON modules FOR SELECT USING (true);
CREATE POLICY "modules_write" ON modules FOR ALL USING (true);
CREATE POLICY "lessons_read" ON lessons FOR SELECT USING (true);
CREATE POLICY "lessons_write" ON lessons FOR ALL USING (true);
CREATE POLICY "enrollments_all" ON enrollments FOR ALL USING (true);
CREATE POLICY "lesson_progress_all" ON lesson_progress FOR ALL USING (true);
CREATE POLICY "quiz_attempts_all" ON quiz_attempts FOR ALL USING (true);
CREATE POLICY "certificates_all" ON certificates FOR ALL USING (true);

-- Indexes
CREATE INDEX idx_modules_course ON modules(course_id, order_index);
CREATE INDEX idx_lessons_module ON lessons(module_id, order_index);
CREATE INDEX idx_enrollments_user ON enrollments(user_id);
CREATE INDEX idx_lesson_progress_user ON lesson_progress(user_id);
CREATE INDEX idx_certificates_user ON certificates(user_id);

-- ============================================================
-- SEED DATA: 6 courses with modules and lessons
-- ============================================================

-- Course 1: Bangladesh Stock Market Fundamentals
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000001-0000-4000-a000-000000000001',
 'Bangladesh Stock Market Fundamentals',
 'Master the basics of stock market investing in Bangladesh. Learn how DSE and CSE operate, understand order types, settlement cycles, and how to read market data. Perfect for beginners starting their investment journey.',
 'basics', 'beginner', 8, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000001-0001-0000-0000-000000000001', '00000001-0000-4000-a000-000000000001', 'Introduction to Stock Markets', 'Understanding the basics of stock exchanges and how they work', 0),
('a0000001-0002-0000-0000-000000000001', '00000001-0000-4000-a000-000000000001', 'How Trading Works', 'Order types, execution, and the settlement process', 1),
('a0000001-0003-0000-0000-000000000001', '00000001-0000-4000-a000-000000000001', 'Reading Market Data', 'Price charts, volume, indices, and market indicators', 2);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
-- Module 1 lessons
('b0000001-0001-0001-0000-000000000001', 'a0000001-0001-0000-0000-000000000001', 'What is the Stock Market?', 'text',
 '{"body": "## What is the Stock Market?\n\nA stock market is a marketplace where shares of publicly listed companies are bought and sold. In Bangladesh, the stock market plays a vital role in the economy by allowing companies to raise capital and giving investors the opportunity to own a piece of those companies.\n\n## Why Invest in Stocks?\n\nStocks have historically been one of the best-performing asset classes over the long term. When you buy a share, you become a part-owner of the company and can benefit from:\n\n- **Capital Appreciation**: The stock price may increase over time\n- **Dividends**: Companies may distribute profits to shareholders\n- **Voting Rights**: Shareholders can vote on company decisions\n\n## The Bangladesh Context\n\nBangladesh has a growing economy with a GDP growth rate consistently above 6%. The stock market offers opportunities in banking, textiles, pharmaceuticals, telecommunications, and more. With over 600 listed companies, there is a wide range of investment options.\n\n## Key Terms\n\n- **Share/Stock**: A unit of ownership in a company\n- **IPO (Initial Public Offering)**: When a company first sells shares to the public\n- **Market Capitalization**: Total value of a company''s outstanding shares\n- **Portfolio**: A collection of investments held by an individual"}',
 0, 15),

('b0000001-0001-0002-0000-000000000001', 'a0000001-0001-0000-0000-000000000001', 'DSE & CSE Overview', 'text',
 '{"body": "## Dhaka Stock Exchange (DSE)\n\nFounded in 1954, the DSE is the largest stock exchange in Bangladesh. It is located in Motijheel, Dhaka and operates as a fully automated electronic exchange.\n\n**Key Facts:**\n- Over 600 listed securities\n- Market categories: A, B, G, N, Z\n- Main index: DSEX (broad), DS30 (blue chip), DSES (Shariah)\n- Trading hours: Sunday to Thursday, 10:00 AM - 2:30 PM\n\n## Chittagong Stock Exchange (CSE)\n\nEstablished in 1995, the CSE is the second stock exchange in Bangladesh. While smaller than DSE, it provides an alternative trading venue.\n\n**Key Facts:**\n- Located in Chittagong (Chattogram)\n- Shares the same listed companies as DSE\n- Has its own indices: CSE All Share Price Index, CSE-30\n\n## Market Categories\n\n- **Category A**: Companies that held AGM regularly and declared dividend >=10%\n- **Category B**: Companies that held AGM but declared dividend <10%\n- **Category G**: Government securities (treasury bonds)\n- **Category N**: Newly listed companies\n- **Category Z**: Companies that failed to hold AGM or declare dividends\n\n## Regulatory Body: BSEC\n\nThe Bangladesh Securities and Exchange Commission (BSEC) is the regulatory authority that oversees the stock market, protects investors, and ensures fair trading practices."}',
 1, 15),

('b0000001-0001-0003-0000-000000000001', 'a0000001-0001-0000-0000-000000000001', 'Module 1 Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "What is the largest stock exchange in Bangladesh?", "options": ["Chittagong Stock Exchange", "Dhaka Stock Exchange", "Bombay Stock Exchange", "London Stock Exchange"], "correct": 1, "explanation": "The Dhaka Stock Exchange (DSE) is the largest stock exchange in Bangladesh, founded in 1954."}, {"id": 2, "question": "Which category represents companies that failed to hold AGM or declare dividends?", "options": ["Category A", "Category B", "Category N", "Category Z"], "correct": 3, "explanation": "Category Z companies have failed to hold their Annual General Meeting or declare dividends."}, {"id": 3, "question": "What does BSEC stand for?", "options": ["Bangladesh Stock Exchange Commission", "Bangladesh Securities and Exchange Commission", "Bangla Securities Exchange Committee", "Bangladesh Share Exchange Council"], "correct": 1, "explanation": "BSEC stands for Bangladesh Securities and Exchange Commission."}, {"id": 4, "question": "When you buy a share of a company, you become a:", "options": ["Creditor", "Part-owner", "Manager", "Employee"], "correct": 1, "explanation": "Buying shares makes you a part-owner (shareholder) of the company."}], "passing_score": 70}',
 2, 10),

-- Module 2 lessons
('b0000001-0002-0001-0000-000000000001', 'a0000001-0002-0000-0000-000000000001', 'Order Types and Execution', 'text',
 '{"body": "## Types of Orders\n\nWhen you want to buy or sell shares, you place an order through your broker. There are several types:\n\n### Market Order\nExecutes immediately at the best available price. Use when you want certainty of execution.\n\n### Limit Order\nSets a maximum price for buying or minimum price for selling. Use when you want price certainty.\n\n### Example\nIf BEXIMCO is trading at BDT 150:\n- Market Buy Order: You buy at whatever the current asking price is (might be 150.50)\n- Limit Buy at 148: Only executes if price drops to 148 or below\n\n## How Orders Get Executed\n\n1. You place an order through your broker\n2. The broker submits it to the exchange (DSE/CSE)\n3. The exchange matching engine pairs buy and sell orders\n4. When a match is found, a trade is executed\n5. You receive a trade confirmation\n\n## Trade Statuses\n\n- **FILL**: Order completely executed\n- **PF (Partial Fill)**: Only part of your order was matched\n- **CANCEL**: Order was cancelled before execution\n- **REJECT**: Order was rejected by the exchange\n\n## Trading Sessions\n\nDSE operates in multiple sessions:\n- **Pre-Opening**: 9:30 AM - 10:00 AM (order entry only)\n- **Continuous Trading**: 10:00 AM - 2:30 PM\n- **Post-Closing**: 2:30 PM - 2:45 PM"}',
 0, 15),

('b0000001-0002-0002-0000-000000000001', 'a0000001-0002-0000-0000-000000000001', 'Settlement Cycles', 'text',
 '{"body": "## What is Settlement?\n\nSettlement is the process of transferring shares from seller to buyer and payment from buyer to seller after a trade is executed.\n\n## Settlement Cycles in Bangladesh\n\nDifferent categories have different settlement periods:\n\n### T+2 Settlement (Most Common)\n- **Category A, B, G, N shares**\n- Trade on Sunday -> Settle on Tuesday\n- Trade on Wednesday -> Settle on next Sunday (skipping Thu-Sat)\n\n### T+3 Settlement\n- **Category Z shares** (buy side)\n- One extra business day for settlement\n\n### Spot Settlement\n- **Compulsory Spot trades**: T+0 for sell, T+1 for buy\n- Used for forced settlements\n\n## What Happens During Settlement?\n\n1. **Trade Day (T)**: Your trade is executed and confirmed\n2. **T+1**: Trade details are verified and matched\n3. **T+2**: Shares are delivered to buyer''s BO account, payment is debited from buyer\n\n## BO Account\n\nA Beneficiary Owner (BO) account is your electronic account at CDBL (Central Depository Bangladesh Limited) where your shares are held in dematerialized form. Think of it as a bank account, but for shares instead of money.\n\n## Important: Unsettled Trades\n\nUntil settlement, your cash balance reflects the pending trade amounts. This is why your available balance may differ from your ledger balance."}',
 1, 15),

('b0000001-0002-0003-0000-000000000001', 'a0000001-0002-0000-0000-000000000001', 'Module 2 Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "What does T+2 mean in settlement?", "options": ["Trade settles in 2 minutes", "Trade settles 2 business days after execution", "Trade was executed 2 days ago", "Trade needs 2 confirmations"], "correct": 1, "explanation": "T+2 means the trade settles 2 business days after the trade date (T)."}, {"id": 2, "question": "Which order type guarantees execution at a specific price or better?", "options": ["Market Order", "Limit Order", "Stop Order", "Day Order"], "correct": 1, "explanation": "A Limit Order sets a price limit - you buy at that price or lower, sell at that price or higher."}, {"id": 3, "question": "What does BO account stand for?", "options": ["Business Owner", "Beneficiary Owner", "Board Officer", "Bank Operation"], "correct": 1, "explanation": "BO stands for Beneficiary Owner - your electronic account for holding shares at CDBL."}], "passing_score": 70}',
 2, 10),

-- Module 3 lessons
('b0000001-0003-0001-0000-000000000001', 'a0000001-0003-0000-0000-000000000001', 'Understanding Price & Volume', 'text',
 '{"body": "## Stock Price\n\nThe price of a stock is determined by supply and demand. When more people want to buy (demand), the price goes up. When more people want to sell (supply), the price goes down.\n\n## Key Price Points\n\n- **Open**: First traded price of the day\n- **High**: Highest price during the day\n- **Low**: Lowest price during the day\n- **Close**: Last traded price (most important)\n- **Previous Close**: Yesterday''s closing price\n\n## Volume\n\nVolume is the number of shares traded during a period. It indicates:\n- **High Volume**: Strong interest, price movement is more significant\n- **Low Volume**: Weak interest, price movement may not be sustainable\n\n## Price Limits\n\nBSEC imposes daily circuit breaker limits:\n- Stocks can move a maximum of +/-10% from previous close\n- This prevents extreme volatility and market manipulation\n\n## Reading a Stock Quote\n\nExample: BEXIMCO\n- Last Price: BDT 152.30\n- Change: +2.30 (+1.53%)\n- Volume: 1,245,000\n- Day Range: 149.00 - 153.50\n\nThis tells you the stock is up 1.53% today on healthy volume of 1.2 million shares."}',
 0, 12),

('b0000001-0003-0002-0000-000000000001', 'a0000001-0003-0000-0000-000000000001', 'Market Indices', 'text',
 '{"body": "## What is a Market Index?\n\nA market index tracks the overall performance of a group of stocks. It gives you a quick snapshot of how the market is doing.\n\n## DSE Indices\n\n### DSEX (DSE Broad Index)\n- Covers all eligible stocks on DSE\n- The most widely followed index in Bangladesh\n- A rise in DSEX means the overall market is going up\n\n### DS30 (DSE 30)\n- Top 30 companies by market cap and trading activity\n- Represents blue-chip stocks\n- Good benchmark for large-cap performance\n\n### DSES (DSE Shariah Index)\n- Shariah-compliant companies\n- For investors who follow Islamic finance principles\n\n## How to Use Indices\n\n1. **Market Direction**: If DSEX is up, the overall market is bullish\n2. **Benchmarking**: Compare your portfolio returns against DSEX\n3. **Sector Performance**: Sector indices show which industries are performing\n\n## Market Capitalization\n\n- **Large Cap**: Market cap > BDT 5,000 Crore (e.g., Grameenphone, Square Pharma)\n- **Mid Cap**: BDT 500 - 5,000 Crore\n- **Small Cap**: < BDT 500 Crore\n\nLarger companies tend to be more stable but grow slower. Smaller companies can grow faster but carry more risk."}',
 1, 12),

('b0000001-0003-0003-0000-000000000001', 'a0000001-0003-0000-0000-000000000001', 'Module 3 Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "What does high trading volume indicate?", "options": ["The stock is expensive", "Strong market interest in the stock", "The company is profitable", "The stock will go up"], "correct": 1, "explanation": "High volume indicates strong market interest. It means many investors are actively buying and selling."}, {"id": 2, "question": "What is DSEX?", "options": ["A stock ticker", "The DSE broad market index", "A trading platform", "A type of order"], "correct": 1, "explanation": "DSEX is the DSE Broad Index that tracks the overall performance of all eligible stocks on the Dhaka Stock Exchange."}, {"id": 3, "question": "What is the daily circuit breaker limit for stocks on DSE?", "options": ["+/-5%", "+/-10%", "+/-15%", "+/-20%"], "correct": 1, "explanation": "BSEC imposes a +/-10% daily circuit breaker limit to prevent extreme volatility."}], "passing_score": 70}',
 2, 10);


-- Course 2: Technical Analysis Masterclass
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000002-0000-4000-a000-000000000001',
 'Technical Analysis Masterclass',
 'Learn to read charts, identify patterns, and use technical indicators to make better trading decisions. Covers candlestick patterns, moving averages, RSI, MACD, and proven trading strategies for the Bangladesh market.',
 'technical', 'intermediate', 12, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000002-0001-0000-0000-000000000001', '00000002-0000-4000-a000-000000000001', 'Chart Patterns', 'Candlestick and chart pattern recognition', 0),
('a0000002-0002-0000-0000-000000000001', '00000002-0000-4000-a000-000000000001', 'Technical Indicators', 'Moving averages, RSI, MACD, and more', 1),
('a0000002-0003-0000-0000-000000000001', '00000002-0000-4000-a000-000000000001', 'Trading Strategies', 'Applying technical analysis in practice', 2);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
('b0000002-0001-0001-0000-000000000001', 'a0000002-0001-0000-0000-000000000001', 'Candlestick Basics', 'text',
 '{"body": "## Candlestick Charts\n\nCandlestick charts are the most popular chart type among traders. Each candle shows four prices: Open, High, Low, Close.\n\n## Anatomy of a Candle\n\n- **Green/White candle**: Close > Open (bullish day)\n- **Red/Black candle**: Close < Open (bearish day)\n- **Body**: The thick part between Open and Close\n- **Wicks/Shadows**: The thin lines above and below the body\n\n## Key Single Candle Patterns\n\n### Doji\nOpen and Close are nearly equal. Shows indecision in the market.\n\n### Hammer\nSmall body at the top with a long lower wick. Bullish reversal signal when it appears after a downtrend.\n\n### Shooting Star\nSmall body at the bottom with a long upper wick. Bearish reversal signal after an uptrend.\n\n### Marubozu\nLong body with no wicks. Strong momentum in that direction.\n\n## Multi-Candle Patterns\n\n### Engulfing Pattern\nSecond candle completely engulfs the first. Bullish engulfing = reversal up; Bearish engulfing = reversal down.\n\n### Morning Star / Evening Star\nThree-candle pattern signaling trend reversals."}',
 0, 20),
('b0000002-0001-0002-0000-000000000001', 'a0000002-0001-0000-0000-000000000001', 'Support and Resistance', 'text',
 '{"body": "## Support Levels\n\nSupport is a price level where buying interest is strong enough to prevent the price from falling further. Think of it as a floor.\n\n## Resistance Levels\n\nResistance is a price level where selling pressure is strong enough to prevent the price from rising further. Think of it as a ceiling.\n\n## How to Identify\n\n1. Look for prices that have been tested multiple times\n2. Round numbers often act as support/resistance (e.g., BDT 100, 200, 500)\n3. Previous highs become resistance; previous lows become support\n4. When support is broken, it often becomes resistance (and vice versa)\n\n## Trendlines\n\nConnect consecutive higher lows for an uptrend line. Connect consecutive lower highs for a downtrend line. These act as dynamic support/resistance.\n\n## Practical Application on DSE\n\nWhen analyzing a stock like GP (Grameenphone):\n- Check the 52-week high and low\n- Identify price levels where the stock has bounced repeatedly\n- Use these levels to plan entry and exit points"}',
 1, 15),
('b0000002-0001-0003-0000-000000000001', 'a0000002-0001-0000-0000-000000000001', 'Chart Patterns Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "A hammer candlestick pattern is:", "options": ["A bearish reversal signal", "A bullish reversal signal after a downtrend", "A continuation pattern", "An indecision pattern"], "correct": 1, "explanation": "A hammer has a small body at the top and long lower wick, signaling potential bullish reversal after a downtrend."}, {"id": 2, "question": "When a support level is broken, it often becomes:", "options": ["Stronger support", "Resistance", "Irrelevant", "A buy signal"], "correct": 1, "explanation": "A broken support level often becomes a new resistance level, as previous buyers now want to exit at breakeven."}], "passing_score": 70}',
 2, 10),
('b0000002-0002-0001-0000-000000000001', 'a0000002-0002-0000-0000-000000000001', 'Moving Averages', 'text',
 '{"body": "## What are Moving Averages?\n\nA moving average smooths out price data by calculating the average price over a specific period. It helps identify trends.\n\n## Types\n\n### Simple Moving Average (SMA)\nArithmetic mean of prices over N periods.\n- SMA(20) = average of last 20 closing prices\n\n### Exponential Moving Average (EMA)\nGives more weight to recent prices, reacts faster to changes.\n\n## Common Periods\n\n- **20-day MA**: Short-term trend\n- **50-day MA**: Medium-term trend\n- **200-day MA**: Long-term trend\n\n## Trading Signals\n\n### Golden Cross (Bullish)\n50-day MA crosses above 200-day MA. Signals potential long-term uptrend.\n\n### Death Cross (Bearish)\n50-day MA crosses below 200-day MA. Signals potential long-term downtrend.\n\n### Price vs MA\n- Price above 200-day MA: Bullish long-term trend\n- Price below 200-day MA: Bearish long-term trend"}',
 0, 15),
('b0000002-0002-0002-0000-000000000001', 'a0000002-0002-0000-0000-000000000001', 'RSI and MACD', 'text',
 '{"body": "## RSI (Relative Strength Index)\n\nRSI measures momentum on a scale of 0-100.\n\n- **Above 70**: Overbought - stock may be due for a pullback\n- **Below 30**: Oversold - stock may be due for a bounce\n- **50 line**: Crossover above 50 is bullish, below is bearish\n\n## MACD (Moving Average Convergence Divergence)\n\nMACD shows the relationship between two EMAs (typically 12 and 26 period).\n\n### Components\n- **MACD Line**: 12 EMA - 26 EMA\n- **Signal Line**: 9 EMA of MACD Line\n- **Histogram**: MACD Line - Signal Line\n\n### Trading Signals\n- **Bullish**: MACD crosses above Signal line\n- **Bearish**: MACD crosses below Signal line\n- **Divergence**: Price makes new high but MACD doesn''t = potential reversal\n\n## Combining Indicators\n\nNever rely on a single indicator. Use RSI + MACD + Moving Averages together for confirmation. If all three align, the signal is stronger."}',
 1, 15),
('b0000002-0002-0003-0000-000000000001', 'a0000002-0002-0000-0000-000000000001', 'Indicators Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "An RSI value of 25 indicates the stock is:", "options": ["Overbought", "Oversold", "Fairly valued", "In a trend"], "correct": 1, "explanation": "RSI below 30 indicates the stock is oversold - it may be due for a bounce."}, {"id": 2, "question": "What is a Golden Cross?", "options": ["50-day MA crosses above 200-day MA", "Price crosses above 200-day MA", "RSI crosses above 70", "MACD crosses above zero"], "correct": 0, "explanation": "A Golden Cross occurs when the 50-day MA crosses above the 200-day MA, signaling a potential long-term uptrend."}], "passing_score": 70}',
 2, 10),
('b0000002-0003-0001-0000-000000000001', 'a0000002-0003-0000-0000-000000000001', 'Building a Trading Plan', 'text',
 '{"body": "## Why You Need a Trading Plan\n\nA trading plan removes emotion from your decisions. It defines your entry, exit, and risk management rules before you trade.\n\n## Components of a Trading Plan\n\n### 1. Entry Rules\n- What signals will trigger a buy?\n- Example: Price above 200 SMA + RSI crossing above 30 + Bullish engulfing candle\n\n### 2. Exit Rules (Take Profit)\n- At what price will you sell for profit?\n- Example: 15% gain from entry, or when RSI > 70\n\n### 3. Stop Loss\n- At what price will you cut losses?\n- Example: 7% below entry price, or below recent support\n\n### 4. Position Sizing\n- Never risk more than 2% of your portfolio on a single trade\n- If portfolio = BDT 500,000 and stop loss = 7%, maximum position = BDT 142,857\n\n### 5. Risk-Reward Ratio\n- Always aim for at least 1:2 risk-reward\n- If risking BDT 7 per share, target BDT 14+ profit per share\n\n## Backtesting\n\nTest your strategy on historical data before risking real money. Does it work on DSE stocks over the last 2 years?"}',
 0, 20);


-- Course 3: Fundamental Analysis & Valuation
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000003-0000-4000-a000-000000000001',
 'Fundamental Analysis & Valuation',
 'Understand how to analyze company financials, evaluate stock valuations using P/E, P/B, EPS, and dividend yield. Learn to read annual reports and identify undervalued stocks on DSE.',
 'fundamental', 'intermediate', 10, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000003-0001-0000-0000-000000000001', '00000003-0000-4000-a000-000000000001', 'Financial Statements', 'Reading balance sheets, income statements, and cash flow', 0),
('a0000003-0002-0000-0000-000000000001', '00000003-0000-4000-a000-000000000001', 'Valuation Ratios', 'P/E, P/B, EPS, dividend yield and more', 1);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
('b0000003-0001-0001-0000-000000000001', 'a0000003-0001-0000-0000-000000000001', 'Reading Financial Statements', 'text',
 '{"body": "## The Three Financial Statements\n\n### 1. Income Statement (Profit & Loss)\nShows revenue, expenses, and profit over a period.\n- **Revenue/Sales**: Total income from business operations\n- **Cost of Goods Sold**: Direct costs of producing goods\n- **Operating Income**: Revenue - Operating Expenses\n- **Net Income**: Bottom line profit after all expenses and taxes\n\n### 2. Balance Sheet\nSnapshot of assets, liabilities, and equity at a point in time.\n- **Assets** = Liabilities + Shareholders'' Equity\n- **Current Assets**: Cash, receivables, inventory (< 1 year)\n- **Non-Current Assets**: Property, equipment, goodwill\n\n### 3. Cash Flow Statement\nTracks actual cash movement:\n- **Operating Cash Flow**: Cash from core business\n- **Investing Cash Flow**: Capital expenditures, investments\n- **Financing Cash Flow**: Debt, equity, dividends\n\n## Where to Find These\n\nAll DSE-listed companies publish annual reports with these statements. Check the DSE website or the company''s investor relations page."}',
 0, 20),
('b0000003-0001-0002-0000-000000000001', 'a0000003-0001-0000-0000-000000000001', 'Financial Statements Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "Which financial statement shows Assets = Liabilities + Equity?", "options": ["Income Statement", "Balance Sheet", "Cash Flow Statement", "Annual Report"], "correct": 1, "explanation": "The Balance Sheet follows the accounting equation: Assets = Liabilities + Shareholders'' Equity."}, {"id": 2, "question": "Net Income is found on which statement?", "options": ["Balance Sheet", "Cash Flow Statement", "Income Statement", "Notes to Financial Statements"], "correct": 2, "explanation": "Net Income (the bottom line profit) is reported on the Income Statement."}], "passing_score": 70}',
 1, 10),
('b0000003-0002-0001-0000-000000000001', 'a0000003-0002-0000-0000-000000000001', 'Key Valuation Ratios', 'text',
 '{"body": "## Price-to-Earnings Ratio (P/E)\n\nP/E = Stock Price / Earnings Per Share\n\n- Low P/E (< 15): May be undervalued or company has problems\n- High P/E (> 25): May be overvalued or market expects high growth\n- Compare P/E with sector average, not across sectors\n\n## Earnings Per Share (EPS)\n\nEPS = Net Income / Total Shares Outstanding\n\nHigher EPS = more profitable on a per-share basis.\n\n## Price-to-Book (P/B)\n\nP/B = Stock Price / Book Value Per Share\n\n- P/B < 1: Stock trading below its net asset value (potentially undervalued)\n- Useful for banks and financial companies\n\n## Dividend Yield\n\nDividend Yield = Annual Dividend / Stock Price x 100\n\n- DSE average: 2-5%\n- Higher yield = more income from dividends\n- Very high yield may indicate price has dropped significantly\n\n## NAV (Net Asset Value)\n\nNAV = (Total Assets - Total Liabilities) / Shares Outstanding\n\nCommon in Bangladesh market analysis. Compare stock price with NAV.\n\n## Practical Example\n\nSquare Pharmaceuticals:\n- Price: BDT 220, EPS: BDT 15, P/E: 14.7x\n- Sector P/E: 18x -> Stock appears undervalued relative to sector"}',
 0, 20),
('b0000003-0002-0002-0000-000000000001', 'a0000003-0002-0000-0000-000000000001', 'Valuation Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "A stock with P/E of 10 and sector average P/E of 20 is likely:", "options": ["Overvalued", "Potentially undervalued", "Fairly valued", "Too risky"], "correct": 1, "explanation": "A P/E below the sector average suggests the stock may be undervalued relative to its peers."}, {"id": 2, "question": "P/B ratio less than 1 means:", "options": ["Company is profitable", "Stock trades below its book value", "Company pays high dividends", "Stock is overvalued"], "correct": 1, "explanation": "P/B < 1 means the stock is trading below its net asset value per share."}], "passing_score": 70}',
 1, 10);


-- Course 4: Risk Management & Margin Trading
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000004-0000-4000-a000-000000000001',
 'Risk Management & Margin Trading',
 'Understand portfolio risk, margin trading rules under BSEC 2025 regulations, position sizing, and how to protect your investments. Essential knowledge for serious investors.',
 'risk', 'advanced', 8, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000004-0001-0000-0000-000000000001', '00000004-0000-4000-a000-000000000001', 'Portfolio Risk Basics', 'Understanding and measuring investment risk', 0),
('a0000004-0002-0000-0000-000000000001', '00000004-0000-4000-a000-000000000001', 'Margin Trading Rules', 'BSEC 2025 margin regulations explained', 1);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
('b0000004-0001-0001-0000-000000000001', 'a0000004-0001-0000-0000-000000000001', 'Understanding Investment Risk', 'text',
 '{"body": "## Types of Risk\n\n### Market Risk (Systematic)\nAffects the entire market. Examples: political instability, inflation, interest rate changes. Cannot be eliminated through diversification.\n\n### Company-Specific Risk (Unsystematic)\nAffects individual companies. Examples: poor management, product failure, scandal. CAN be reduced through diversification.\n\n## Risk Metrics\n\n### Volatility\nMeasures how much a stock price fluctuates. Higher volatility = higher risk.\n\n### Beta\n- Beta = 1: Moves with the market\n- Beta > 1: More volatile than market\n- Beta < 1: Less volatile than market\n\n## Diversification\n\nDon''t put all eggs in one basket:\n- Spread across 10-15 stocks minimum\n- Diversify across sectors (bank, pharma, textile, telecom)\n- No single stock > 10% of portfolio\n\n## The Risk-Return Tradeoff\n\nHigher potential returns come with higher risk. Government bonds = low risk, low return. Small-cap stocks = high risk, high potential return.\n\n## Golden Rule\n\nNever invest money you cannot afford to lose. Emergency fund first, then invest."}',
 0, 15),
('b0000004-0002-0001-0000-000000000001', 'a0000004-0002-0000-0000-000000000001', 'BSEC Margin Rules 2025', 'text',
 '{"body": "## What is Margin Trading?\n\nMargin trading allows you to buy stocks with borrowed money from your broker. You deposit a portion (margin), and the broker lends the rest.\n\n## BSEC Margin Rules 2025\n\n### Margin Ratios\n- Portfolio BDT 5-10 Lakh: Maximum 1:0.5 (borrow up to 50% of your equity)\n- Portfolio > BDT 10 Lakh: Maximum 1:1 (borrow up to 100% of your equity)\n- If market P/E > 20: All ratios capped at 1:0.5\n\n### Three Alert Levels\n\n1. **NORMAL**: Equity >= 75% of loan. No action needed.\n2. **MARGIN CALL**: Equity < 75% of loan. You have 3 business days to deposit more money or sell stocks.\n3. **FORCE SELL**: Equity <= 50% of loan. Broker must sell your stocks immediately.\n\n### Eligible Securities\nNot all stocks can be used for margin:\n- Must be Category A on Main Board\n- Category B with >= 5% annual dividend\n- Free float market cap >= BDT 50 Crore\n- P/E ratio <= 30 (or 2x sector median)\n\n### Key Responsibilities\n- Monitor your margin ratio daily\n- Respond to margin calls within 3 business days\n- Keep extra cash buffer for market downturns\n\n## Warning\nMargin trading amplifies both gains AND losses. A 10% drop with 1:1 margin = 20% loss on your equity."}',
 0, 20),
('b0000004-0002-0002-0000-000000000001', 'a0000004-0002-0000-0000-000000000001', 'Margin Trading Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "Under BSEC 2025 rules, a Margin Call is triggered when equity falls below:", "options": ["100% of loan", "75% of loan", "50% of loan", "25% of loan"], "correct": 1, "explanation": "Margin Call is triggered when equity drops below 75% of the margin finance (loan)."}, {"id": 2, "question": "How many business days do you have to respond to a Margin Call?", "options": ["1 day", "2 days", "3 days", "5 days"], "correct": 2, "explanation": "Under BSEC 2025 rules, clients have 3 business days to respond to a Margin Call before Force Sell."}, {"id": 3, "question": "With a 1:1 margin ratio and BDT 500,000 equity, how much can you borrow?", "options": ["BDT 250,000", "BDT 500,000", "BDT 1,000,000", "BDT 750,000"], "correct": 1, "explanation": "1:1 ratio means you can borrow up to 100% of your equity, so BDT 500,000."}], "passing_score": 70}',
 1, 10);


-- Course 5: Wealth Management Essentials
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000005-0000-4000-a000-000000000001',
 'Wealth Management Essentials',
 'Learn the principles of financial planning, asset allocation, retirement planning, and building long-term wealth. Designed for anyone who wants to take control of their financial future in Bangladesh.',
 'wealth', 'beginner', 6, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000005-0001-0000-0000-000000000001', '00000005-0000-4000-a000-000000000001', 'Financial Planning Basics', 'Setting goals and building a financial plan', 0),
('a0000005-0002-0000-0000-000000000001', '00000005-0000-4000-a000-000000000001', 'Investment Strategies', 'Asset allocation and portfolio construction', 1),
('a0000005-0003-0000-0000-000000000001', '00000005-0000-4000-a000-000000000001', 'Retirement & Tax Planning', 'Long-term wealth building in Bangladesh', 2);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
('b0000005-0001-0001-0000-000000000001', 'a0000005-0001-0000-0000-000000000001', 'Setting Financial Goals', 'text',
 '{"body": "## Why Financial Planning Matters\n\nWithout a plan, money decisions become reactive. A financial plan gives you a roadmap to achieve your life goals.\n\n## SMART Goals\n\n- **Specific**: \"Save BDT 50 Lakh for a house\" not \"Save more money\"\n- **Measurable**: Track progress monthly\n- **Achievable**: Based on your income and expenses\n- **Relevant**: Aligned with your values and priorities\n- **Time-bound**: \"By December 2030\"\n\n## Three Categories of Goals\n\n### Short-term (< 1 year)\n- Emergency fund (6 months of expenses)\n- Pay off credit card debt\n- Save for vacation\n\n### Medium-term (1-5 years)\n- Down payment for home\n- Children''s education fund\n- Start a business\n\n### Long-term (5+ years)\n- Retirement fund\n- Wealth building\n- Legacy planning\n\n## The 50/30/20 Rule\n\n- 50% of income: Needs (rent, food, utilities)\n- 30% of income: Wants (entertainment, dining)\n- 20% of income: Savings and investments\n\n## Start Early: The Power of Compounding\n\nBDT 10,000/month invested at 12% annual return:\n- 10 years: BDT 23 Lakh\n- 20 years: BDT 99 Lakh\n- 30 years: BDT 3.5 Crore"}',
 0, 15),
('b0000005-0002-0001-0000-000000000001', 'a0000005-0002-0000-0000-000000000001', 'Asset Allocation', 'text',
 '{"body": "## What is Asset Allocation?\n\nDividing your investments across different asset classes to balance risk and return.\n\n## Asset Classes in Bangladesh\n\n### Equities (Stocks)\n- Potential return: 10-15% per year\n- Risk: High\n- Suitable for: Long-term growth\n\n### Fixed Deposits\n- Return: 6-9% per year\n- Risk: Very low\n- Suitable for: Capital preservation, emergency fund\n\n### Government Bonds/Sanchayapatra\n- Return: 9-12% per year (tax-free up to limits)\n- Risk: Minimal (government backed)\n- Suitable for: Regular income, retirement\n\n### Real Estate\n- Return: Variable (rental + appreciation)\n- Risk: Medium\n- Suitable for: Long-term wealth\n\n### Gold\n- Return: Tracks international gold prices\n- Risk: Medium\n- Suitable for: Hedge against inflation\n\n## Sample Allocations by Age\n\n### Age 25-35 (Aggressive)\n- 60% Stocks, 20% Sanchayapatra, 10% FD, 10% Gold\n\n### Age 35-50 (Balanced)\n- 40% Stocks, 30% Sanchayapatra, 20% FD, 10% Gold\n\n### Age 50+ (Conservative)\n- 20% Stocks, 40% Sanchayapatra, 30% FD, 10% Gold"}',
 0, 15),
('b0000005-0003-0001-0000-000000000001', 'a0000005-0003-0000-0000-000000000001', 'Retirement Planning in Bangladesh', 'text',
 '{"body": "## Retirement Reality\n\nMost Bangladeshis depend on family for retirement support. But with changing demographics, you need your own retirement plan.\n\n## How Much Do You Need?\n\nRule of thumb: 25x your annual expenses.\n- Monthly expenses: BDT 50,000\n- Annual: BDT 6,00,000\n- Retirement corpus needed: BDT 1.5 Crore\n\n## Retirement Investment Vehicles\n\n### National Savings Certificates (Sanchayapatra)\n- 5-Year Bangladesh Sanchayapatra: ~11.5%\n- 3-Month Profit Sanchayapatra: ~11.04%\n- Family Sanchayapatra (women only): ~11.5%\n- Tax-free up to BDT 5 Lakh investment\n\n### Provident Fund\n- Employer-matched savings\n- Tax benefits on contributions\n\n### Stock Portfolio\n- Build a dividend-focused portfolio\n- Blue-chip stocks with consistent dividends\n- Reinvest dividends for compounding\n\n## Tax Planning\n\n- Investment tax credit: Up to 15% tax rebate on qualifying investments\n- Qualifying investments: stocks, mutual funds, life insurance, sanchayapatra\n- Maximum eligible amount: BDT 1.5 Crore or 25% of income\n\n## Start Today\n\nThe best time to start was 20 years ago. The second best time is now. Even BDT 5,000/month makes a massive difference over 25 years."}',
 0, 15),
('b0000005-0003-0002-0000-000000000001', 'a0000005-0003-0000-0000-000000000001', 'Wealth Management Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "The 50/30/20 rule suggests what percentage for savings?", "options": ["10%", "20%", "30%", "50%"], "correct": 1, "explanation": "The 50/30/20 rule allocates 50% to needs, 30% to wants, and 20% to savings and investments."}, {"id": 2, "question": "How much retirement corpus do you need if annual expenses are BDT 6 Lakh?", "options": ["BDT 60 Lakh", "BDT 1 Crore", "BDT 1.5 Crore", "BDT 2 Crore"], "correct": 2, "explanation": "The 25x rule: 25 x BDT 6,00,000 = BDT 1,50,00,000 (1.5 Crore)."}, {"id": 3, "question": "Which investment is government-backed with ~11.5% return?", "options": ["Fixed Deposit", "Stock Market", "Sanchayapatra", "Mutual Fund"], "correct": 2, "explanation": "National Savings Certificates (Sanchayapatra) are government-backed and offer approximately 11.5% return."}], "passing_score": 70}',
 1, 10);


-- Course 6: Career in Financial Services
INSERT INTO courses (id, title, description, category, level, duration_hours, is_published) VALUES
('00000006-0000-4000-a000-000000000001',
 'Career in Financial Services',
 'Explore career opportunities in the Bangladesh financial industry. Learn about brokerage operations, relationship management, risk management, and how to build a successful career in finance.',
 'career', 'beginner', 4, true);

INSERT INTO modules (id, course_id, title, description, order_index) VALUES
('a0000006-0001-0000-0000-000000000001', '00000006-0000-4000-a000-000000000001', 'Careers in Finance', 'Overview of financial career paths', 0),
('a0000006-0002-0000-0000-000000000001', '00000006-0000-4000-a000-000000000001', 'Skills & Certifications', 'Building your finance career toolkit', 1);

INSERT INTO lessons (id, module_id, title, type, content, order_index, duration_minutes) VALUES
('b0000006-0001-0001-0000-000000000001', 'a0000006-0001-0000-0000-000000000001', 'Financial Career Paths', 'text',
 '{"body": "## Career Opportunities\n\n### 1. Stock Broker / Dealer\n- Execute trades on behalf of clients\n- Requires BSEC registration\n- Income: Base salary + commission\n\n### 2. Relationship Manager (RM)\n- Manage client portfolios and relationships\n- Provide investment advice\n- Build and maintain client base\n- Income: BDT 40,000 - 1,50,000/month + incentives\n\n### 3. Risk Manager\n- Monitor margin accounts and portfolio risk\n- Enforce BSEC regulations\n- Generate risk reports\n- Income: BDT 50,000 - 2,00,000/month\n\n### 4. Research Analyst\n- Analyze companies and sectors\n- Write research reports\n- Provide buy/sell recommendations\n- Income: BDT 35,000 - 1,50,000/month\n\n### 5. Investment Banker\n- IPO management\n- Mergers and acquisitions advisory\n- Corporate finance\n- Income: BDT 80,000 - 5,00,000/month\n\n### 6. Fund Manager\n- Manage mutual funds or private portfolios\n- Make investment decisions\n- Track fund performance\n- Income: BDT 1,00,000 - 10,00,000/month\n\n## Getting Started\n\nMost entry-level positions require a bachelor''s degree in Finance, Accounting, Economics, or BBA. Internships at brokerage firms are the best entry point."}',
 0, 15),
('b0000006-0002-0001-0000-000000000001', 'a0000006-0002-0000-0000-000000000001', 'Essential Skills', 'text',
 '{"body": "## Technical Skills\n\n### Financial Analysis\n- Read and interpret financial statements\n- Calculate valuation ratios\n- Understand accounting principles\n\n### Market Knowledge\n- DSE/CSE operations\n- BSEC regulations\n- Current market trends\n\n### Technology\n- Excel (advanced formulas, pivot tables)\n- Trading platforms\n- Data analysis tools\n- Bloomberg/Reuters terminals\n\n## Soft Skills\n\n### Communication\n- Explain complex concepts simply\n- Write clear research reports\n- Present to clients confidently\n\n### Analytical Thinking\n- Process large amounts of data\n- Identify patterns and trends\n- Make decisions under uncertainty\n\n### Ethics & Integrity\n- Handle client money responsibly\n- Follow regulations strictly\n- Maintain confidentiality\n\n## Certifications\n\n### In Bangladesh\n- BSEC Dealer Registration\n- Bangladesh Institute of Capital Market (BICM) courses\n\n### International (Career Boosters)\n- CFA (Chartered Financial Analyst)\n- FRM (Financial Risk Manager)\n- CPA (Certified Public Accountant)\n- CFP (Certified Financial Planner)\n\n## UCB Stock Career Program\n\nComplete all courses in this Learning Center to earn your UCB Stock Certificate and become eligible for career opportunities at UCB Stock Brokerage."}',
 0, 15),
('b0000006-0002-0002-0000-000000000001', 'a0000006-0002-0000-0000-000000000001', 'Career Quiz', 'quiz',
 '{"questions": [{"id": 1, "question": "Which role is responsible for monitoring margin accounts and enforcing regulations?", "options": ["Research Analyst", "Relationship Manager", "Risk Manager", "Fund Manager"], "correct": 2, "explanation": "Risk Managers monitor margin accounts, portfolio risk, and ensure compliance with BSEC regulations."}, {"id": 2, "question": "CFA stands for:", "options": ["Certified Financial Advisor", "Chartered Financial Analyst", "Corporate Finance Associate", "Certified Fund Administrator"], "correct": 1, "explanation": "CFA stands for Chartered Financial Analyst, one of the most respected designations in finance globally."}], "passing_score": 70}',
 1, 10);
