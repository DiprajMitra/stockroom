-- Inventory Control System | CSE212(B2) Database Systems Lab | Phase 3
-- Dialect: MySQL 8.0+ (CHECK constraints are enforced from 8.0.16)

DROP DATABASE IF EXISTS inventory_db;
CREATE DATABASE inventory_db;
USE inventory_db;

/* ===================== PART 1: DDL ===================== */

CREATE TABLE roles (
  role_id   INT AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role_id       INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

CREATE TABLE categories (
  category_id      INT AUTO_INCREMENT PRIMARY KEY,
  category_name    VARCHAR(100) NOT NULL UNIQUE,
  default_tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0
    CHECK (default_tax_rate BETWEEN 0 AND 100)
);

CREATE TABLE suppliers (
  supplier_id  INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  contact_info VARCHAR(255)
);

CREATE TABLE products (
  product_id        INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150) NOT NULL,
  sku               VARCHAR(100) NOT NULL UNIQUE,
  category_id       INT NOT NULL,
  unit_price        DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate_override DECIMAL(5,2) NULL CHECK (tax_rate_override BETWEEN 0 AND 100),
  reorder_level     INT NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  current_stock     INT NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        INT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(category_id),
  FOREIGN KEY (created_by)  REFERENCES users(user_id)
);

CREATE TABLE purchases (
  purchase_id   INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id   INT NOT NULL,
  user_id       INT NOT NULL,
  purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_cost    DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
  FOREIGN KEY (user_id)     REFERENCES users(user_id)
);

CREATE TABLE purchase_items (
  purchase_item_id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id      INT NOT NULL,
  product_id       INT NOT NULL,
  quantity         INT NOT NULL CHECK (quantity > 0),
  unit_cost        DECIMAL(12,2) NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES products(product_id)
);

CREATE TABLE sales (
  sale_id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  sale_date      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  customer_name  VARCHAR(150) NULL,
  order_subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_tax      DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE sale_items (
  sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id      INT NOT NULL,
  product_id   INT NOT NULL,
  quantity     INT NOT NULL CHECK (quantity > 0),
  unit_price   DECIMAL(12,2) NOT NULL,
  tax_rate     DECIMAL(5,2)  NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  subtotal     DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (sale_id)    REFERENCES sales(sale_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- Indexes (scalability)
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_purchases_date ON purchases(purchase_date);
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

-- Triggers
DELIMITER //

-- Purchase received -> stock goes up, purchase total updated
CREATE TRIGGER trg_purchase_item_ai AFTER INSERT ON purchase_items
FOR EACH ROW
BEGIN
  UPDATE products SET current_stock = current_stock + NEW.quantity
   WHERE product_id = NEW.product_id;
  UPDATE purchases SET total_cost = total_cost + NEW.quantity * NEW.unit_cost
   WHERE purchase_id = NEW.purchase_id;
END//

-- Sale line: copy price + effective tax rate, compute subtotal/tax/total
CREATE TRIGGER trg_sale_item_bi BEFORE INSERT ON sale_items
FOR EACH ROW
BEGIN
  DECLARE v_price DECIMAL(12,2);
  DECLARE v_rate  DECIMAL(5,2);
  SELECT p.unit_price, COALESCE(p.tax_rate_override, c.default_tax_rate)
    INTO v_price, v_rate
    FROM products p JOIN categories c ON c.category_id = p.category_id
   WHERE p.product_id = NEW.product_id;
  SET NEW.unit_price = v_price;
  SET NEW.tax_rate   = v_rate;
  SET NEW.subtotal   = v_price * NEW.quantity;
  SET NEW.tax_amount = ROUND(NEW.subtotal * v_rate / 100, 2);
  SET NEW.line_total = NEW.subtotal + NEW.tax_amount;
END//

-- Sale line saved -> stock goes down (CHECK blocks negative stock), header totals updated
CREATE TRIGGER trg_sale_item_ai AFTER INSERT ON sale_items
FOR EACH ROW
BEGIN
  UPDATE products SET current_stock = current_stock - NEW.quantity
   WHERE product_id = NEW.product_id;
  UPDATE sales SET order_subtotal = order_subtotal + NEW.subtotal,
                   total_tax      = total_tax + NEW.tax_amount,
                   grand_total    = grand_total + NEW.line_total
   WHERE sale_id = NEW.sale_id;
END//

DELIMITER ;

-- Views
CREATE VIEW v_current_stock AS
SELECT p.product_id, p.name, p.sku, c.category_name, p.current_stock, p.reorder_level
  FROM products p JOIN categories c ON c.category_id = p.category_id;

CREATE VIEW v_low_stock AS
SELECT product_id, name, sku, current_stock, reorder_level
  FROM products WHERE current_stock <= reorder_level;

CREATE VIEW v_tax_summary AS
SELECT DATE(s.sale_date) AS sale_day, c.category_name,
       SUM(si.subtotal) AS taxable_amount, SUM(si.tax_amount) AS tax_collected
  FROM sale_items si
  JOIN sales s      ON s.sale_id = si.sale_id
  JOIN products p   ON p.product_id = si.product_id
  JOIN categories c ON c.category_id = p.category_id
 GROUP BY DATE(s.sale_date), c.category_name;

/* ===================== PART 2: DML ===================== */

-- INSERT
INSERT INTO roles (role_name) VALUES ('admin'), ('sales_staff'), ('inventory_clerk');

INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('zubaer', SHA2('admin123',256), 'Md. Zubaer', 1),
 ('nasim',  SHA2('sales123',256), 'Nasim Mahmud', 2),
 ('dipraj', SHA2('stock123',256), 'Dipraj Mitra Chandon', 3);

INSERT INTO categories (category_name, default_tax_rate) VALUES
 ('Electronics', 15.00), ('Groceries', 5.00), ('Stationery', 10.00), ('Essential Medicine', 0.00);

INSERT INTO suppliers (name, contact_info) VALUES
 ('Rahim Traders', '01711-000001'), ('Dhaka Wholesale Ltd', 'info@dhakawholesale.example'),
 ('Star Distributors', NULL);

INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('USB Flash Drive 32GB', 'ELC-001', 1, 650.00, NULL, 10, 1),
 ('Wireless Mouse',       'ELC-002', 1, 900.00, NULL, 8, 1),
 ('Basmati Rice 5kg',     'GRC-001', 2, 780.00, NULL, 15, 1),
 ('Notebook A4',          'STN-001', 3, 120.00, NULL, 20, 1),
 ('Paracetamol 500mg',    'MED-001', 4,  30.00, NULL, 50, 1),
 ('Printer Ink (exempt)', 'ELC-003', 1, 1500.00, 0.00, 5, 1);

-- Purchases (stock received; trigger raises current_stock)
INSERT INTO purchases (supplier_id, user_id) VALUES (1, 3), (2, 3);
INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES
 (1, 1, 40, 500.00), (1, 2, 25, 700.00), (1, 6, 6, 1200.00),
 (2, 3, 60, 650.00), (2, 4, 100, 80.00), (2, 5, 200, 20.00);

-- Sale as one transaction (stock + totals updated atomically)
START TRANSACTION;
  INSERT INTO sales (user_id, customer_name) VALUES (2, 'Karim Uddin');
  SET @sid = LAST_INSERT_ID();
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES
   (@sid, 1, 3, 0), (@sid, 3, 2, 0), (@sid, 6, 1, 0);   -- price/tax filled by trigger
COMMIT;

START TRANSACTION;
  INSERT INTO sales (user_id, customer_name) VALUES (2, 'Walk-in');
  SET @sid = LAST_INSERT_ID();
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES
   (@sid, 4, 5, 0), (@sid, 5, 10, 0);
COMMIT;

-- UPDATE
UPDATE products   SET unit_price = 950.00 WHERE sku = 'ELC-002';
UPDATE categories SET default_tax_rate = 7.50 WHERE category_name = 'Groceries';
UPDATE suppliers  SET contact_info = '01911-000003' WHERE name = 'Star Distributors';
UPDATE users      SET role_id = 1 WHERE username = 'dipraj';
UPDATE users      SET role_id = 3 WHERE username = 'dipraj';   -- revert

-- DELETE
DELETE FROM suppliers WHERE name = 'Star Distributors';        -- no purchases yet, allowed
-- DELETE FROM products WHERE sku='ELC-001';                   -- fails: FK from sale_items (data integrity)

/* ===================== PART 3: SELECT QUERIES ===================== */

-- Search product by name / SKU
SELECT * FROM products WHERE name LIKE '%mouse%' OR sku = 'GRC-001';

-- Current stock and low-stock alerts
SELECT * FROM v_current_stock ORDER BY category_name, name;
SELECT * FROM v_low_stock;

-- Multi-table JOIN: receipt for sale 1
SELECT s.sale_id, s.customer_name, p.name, si.quantity, si.unit_price,
       si.tax_rate, si.tax_amount, si.line_total
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.sale_id
  JOIN products p    ON p.product_id = si.product_id
 WHERE s.sale_id = 1;

-- Total sales per day
SELECT DATE(sale_date) AS day, COUNT(*) AS orders, SUM(grand_total) AS revenue
  FROM sales GROUP BY DATE(sale_date);

-- Best-selling products
SELECT p.name, SUM(si.quantity) AS units_sold
  FROM sale_items si JOIN products p ON p.product_id = si.product_id
 GROUP BY p.product_id, p.name ORDER BY units_sold DESC LIMIT 5;

-- Tax collected per category
SELECT * FROM v_tax_summary;

-- Supplier purchase history
SELECT sp.name AS supplier, pu.purchase_id, pu.purchase_date, pu.total_cost
  FROM purchases pu JOIN suppliers sp ON sp.supplier_id = pu.supplier_id
 ORDER BY pu.purchase_date DESC;

-- Users with roles
SELECT u.username, u.full_name, r.role_name
  FROM users u JOIN roles r ON r.role_id = u.role_id;

-- Login check (returns one row when username and password are correct)
SELECT u.user_id, u.full_name, r.role_name
  FROM users u JOIN roles r ON r.role_id = u.role_id
 WHERE u.username = 'nasim' AND u.password_hash = SHA2('sales123', 256);

-- Integrity test (must fail): selling more than available stock
-- INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (1, 6, 999, 0);

/* ===================== PART 4: Role-based access (server side) =====================
   The application backend must enforce the same role matrix that the UI hides.
   The pattern below uses a session variable (set at the start of every request
   from the verified JWT/session) and a check_role procedure that raises a
   SQLSTATE '42000' error - the application maps that to HTTP 403.
   =============================================================================== */

-- Run once per request: SET @app_user_role = 'sales_staff';  -- (or 'admin' / 'inventory_clerk')
-- The procedures below read @app_user_role and refuse work that is not permitted.

DELIMITER //

-- Helper: raise a 403-style error if the current role is not allowed.
CREATE PROCEDURE check_role(IN allowed_roles VARCHAR(255))
BEGIN
  IF @app_user_role IS NULL THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '403: no session role set';
  END IF;
  IF FIND_IN_SET(@app_user_role, allowed_roles) = 0 THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '403: role not permitted for this operation';
  END IF;
END//

-- sp_create_purchase: only inventory_clerk and admin can record stock arrivals.
CREATE PROCEDURE sp_create_purchase(
  IN p_supplier_id INT, IN p_user_id INT, IN p_product_id INT,
  IN p_quantity INT, IN p_unit_cost DECIMAL(12,2))
BEGIN
  CALL check_role('admin,inventory_clerk');
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: quantity must be greater than 0';
  END IF;
  START TRANSACTION;
    INSERT INTO purchases (supplier_id, user_id) VALUES (p_supplier_id, p_user_id);
    SET @pid = LAST_INSERT_ID();
    INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost)
      VALUES (@pid, p_product_id, p_quantity, p_unit_cost);
  COMMIT;
END//

-- sp_record_sale: only sales_staff and admin can record sales.
CREATE PROCEDURE sp_record_sale(
  IN p_user_id INT, IN p_customer VARCHAR(150))
BEGIN
  CALL check_role('admin,sales_staff');
  INSERT INTO sales (user_id, customer_name) VALUES (p_user_id, p_customer);
  SELECT LAST_INSERT_ID() AS new_sale_id;
END//

-- sp_add_sale_item: only sales_staff and admin; the trigger blocks negative stock.
CREATE PROCEDURE sp_add_sale_item(
  IN p_sale_id INT, IN p_product_id INT, IN p_quantity INT)
BEGIN
  CALL check_role('admin,sales_staff');
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: quantity must be greater than 0';
  END IF;
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
    VALUES (p_sale_id, p_product_id, p_quantity, 0);
END//

-- sp_save_product / sp_delete_product
CREATE PROCEDURE sp_save_product(
  IN p_name VARCHAR(150), IN p_sku VARCHAR(100), IN p_category_id INT,
  IN p_unit_price DECIMAL(12,2), IN p_reorder_level INT,
  IN p_tax_override DECIMAL(5,2), IN p_user_id INT)
BEGIN
  CALL check_role('admin,inventory_clerk');
  INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by)
    VALUES (p_name, p_sku, p_category_id, p_unit_price, p_tax_override, p_reorder_level, p_user_id);
END//

CREATE PROCEDURE sp_delete_product(IN p_product_id INT)
BEGIN
  CALL check_role('admin');
  IF EXISTS(SELECT 1 FROM purchase_items WHERE product_id = p_product_id)
     OR EXISTS(SELECT 1 FROM sale_items     WHERE product_id = p_product_id) THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: product has purchase or sale records';
  END IF;
  DELETE FROM products WHERE product_id = p_product_id;
END//

-- sp_save_category / sp_delete_category
CREATE PROCEDURE sp_save_category(IN p_name VARCHAR(100), IN p_tax DECIMAL(5,2))
BEGIN
  CALL check_role('admin,inventory_clerk');
  INSERT INTO categories (category_name, default_tax_rate) VALUES (p_name, p_tax);
END//

CREATE PROCEDURE sp_delete_category(IN p_category_id INT)
BEGIN
  CALL check_role('admin');
  IF EXISTS(SELECT 1 FROM products WHERE category_id = p_category_id) THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: category still has products';
  END IF;
  DELETE FROM categories WHERE category_id = p_category_id;
END//

-- sp_save_supplier / sp_delete_supplier
CREATE PROCEDURE sp_save_supplier(IN p_name VARCHAR(150), IN p_contact VARCHAR(255))
BEGIN
  CALL check_role('admin,inventory_clerk');
  INSERT INTO suppliers (name, contact_info) VALUES (p_name, p_contact);
END//

CREATE PROCEDURE sp_delete_supplier(IN p_supplier_id INT)
BEGIN
  CALL check_role('admin');
  IF EXISTS(SELECT 1 FROM purchases WHERE supplier_id = p_supplier_id) THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: supplier has purchase records';
  END IF;
  DELETE FROM suppliers WHERE supplier_id = p_supplier_id;
END//

-- sp_save_user / sp_delete_user / sp_set_user_role: admin only.
CREATE PROCEDURE sp_save_user(
  IN p_username VARCHAR(100), IN p_password VARCHAR(255),
  IN p_full_name VARCHAR(150), IN p_role_name VARCHAR(50))
BEGIN
  CALL check_role('admin');
  INSERT INTO users (username, password_hash, full_name, role_id)
    VALUES (p_username, SHA2(p_password, 256), p_full_name,
            (SELECT role_id FROM roles WHERE role_name = p_role_name));
END//

CREATE PROCEDURE sp_set_user_role(IN p_user_id INT, IN p_role_name VARCHAR(50))
BEGIN
  CALL check_role('admin');
  UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name = p_role_name)
   WHERE user_id = p_user_id;
END//

CREATE PROCEDURE sp_delete_user(IN p_user_id INT)
BEGIN
  CALL check_role('admin');
  IF EXISTS(SELECT 1 FROM sales      WHERE user_id = p_user_id)
     OR EXISTS(SELECT 1 FROM purchases WHERE user_id = p_user_id) THEN
    SIGNAL SQLSTATE '42000' SET MESSAGE_TEXT = '400: user has recorded sales or purchases';
  END IF;
  DELETE FROM users WHERE user_id = p_user_id;
END//

-- Reports: the SELECTs each role is allowed to run.
-- inventory_clerk can read stock and purchase history, but never sales/tax.
CREATE PROCEDURE sp_report_current_stock()
BEGIN
  CALL check_role('admin,sales_staff,inventory_clerk');
  SELECT * FROM v_current_stock ORDER BY category_name, name;
END//

CREATE PROCEDURE sp_report_low_stock()
BEGIN
  CALL check_role('admin,sales_staff,inventory_clerk');
  SELECT * FROM v_low_stock;
END//

CREATE PROCEDURE sp_report_sales_per_day()
BEGIN
  CALL check_role('admin,sales_staff');  -- inventory_clerk denied
  SELECT DATE(sale_date) AS day, COUNT(*) AS orders, SUM(grand_total) AS revenue
    FROM sales GROUP BY DATE(sale_date);
END//

CREATE PROCEDURE sp_report_best_sellers()
BEGIN
  CALL check_role('admin,sales_staff');
  SELECT p.name, SUM(si.quantity) AS units_sold
    FROM sale_items si JOIN products p ON p.product_id = si.product_id
   GROUP BY p.product_id, p.name ORDER BY units_sold DESC LIMIT 5;
END//

CREATE PROCEDURE sp_report_tax_collected()
BEGIN
  CALL check_role('admin,sales_staff');
  SELECT * FROM v_tax_summary;
END//

-- Read-only user list (admin only).
CREATE PROCEDURE sp_list_users()
BEGIN
  CALL check_role('admin');
  SELECT u.username, u.full_name, r.role_name
    FROM users u JOIN roles r ON r.role_id = r.role_id;
END//

DELIMITER ;

-- Example call flow (the application would do this on every request):
--   SET @app_user_role = 'inventory_clerk';
--   CALL sp_create_purchase(1, 3, 1, 25, 500);    -- ok
--   CALL sp_record_sale(2, 'Walk-in');             -- 403: not allowed
--   CALL sp_report_sales_per_day();                -- 403: not allowed
--   CALL sp_report_current_stock();                -- ok

