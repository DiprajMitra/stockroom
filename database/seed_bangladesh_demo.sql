-- =============================================================================
--  Inventory Control System | Bangladesh-flavoured seed data
--
--  This file inserts ONLY the data.  Run it AFTER
--  inventory_control_system_oracle.sql has created the schema, OR if
--  you just want to wipe the existing data and re-seed:
--
--    BEGIN
--      app_ctx_pkg.set_role('admin');
--      DELETE FROM sale_items;
--      DELETE FROM sales;
--      DELETE FROM purchase_items;
--      DELETE FROM purchases;
--      UPDATE products SET current_stock = 0;
--      DELETE FROM products;
--      DELETE FROM suppliers;
--      DELETE FROM categories;
--      DELETE FROM users WHERE username NOT IN ('zubaer','nasim','dipraj');
--      DELETE FROM roles;
--      app_ctx_pkg.set_role(NULL);
--    END;
--    /
--    COMMIT;
--    /
--    @seed_bangladesh_demo.sql
--
--  HOW TO RUN ALONE (after schema is in place):
--    set the role to admin, then paste this whole file and press F5.
-- =============================================================================

BEGIN
  app_ctx_pkg.set_role('admin');
END;
/

-- ----- Roles -----
INSERT INTO roles (role_name)              VALUES ('admin');
INSERT INTO roles (role_name)              VALUES ('sales_staff');
INSERT INTO roles (role_name)              VALUES ('inventory_clerk');
COMMIT;
/

-- ----- Users (plain-text passwords for the classroom demo) -----
-- Keep the demo accounts so the README login table stays valid.
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('zubaer', 'admin123', 'Md. Zubaer',
  (SELECT role_id FROM roles WHERE role_name = 'admin'));
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('nasim',  'sales123', 'Nasim Mahmud',
  (SELECT role_id FROM roles WHERE role_name = 'sales_staff'));
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('dipraj', 'stock123', 'Dipraj Mitra Chandon',
  (SELECT role_id FROM roles WHERE role_name = 'inventory_clerk'));
-- Extra staff (so the Users & Roles page has multiple rows)
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('arif',    'arif123',  'Arif Hossain',
  (SELECT role_id FROM roles WHERE role_name = 'sales_staff'));
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('tania',   'tania123', 'Tania Akter',
  (SELECT role_id FROM roles WHERE role_name = 'sales_staff'));
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('rakib',   'rakib123', 'Rakibul Islam',
  (SELECT role_id FROM roles WHERE role_name = 'inventory_clerk'));
INSERT INTO users (username, password_hash, full_name, role_id) VALUES
 ('sumaiya', 'sumaiya123', 'Sumaiya Rahman',
  (SELECT role_id FROM roles WHERE role_name = 'inventory_clerk'));
COMMIT;
/

-- ----- Categories (BD-relevant) -----
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Electronics',         15.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Groceries',            5.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Stationery',          10.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Essential Medicine',   0.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Beverages',           10.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Bakery & Snacks',      5.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Personal Care',       15.00);
INSERT INTO categories (category_name, default_tax_rate) VALUES ('Books & Education',    0.00);
COMMIT;
/

-- ----- Suppliers -----
INSERT INTO suppliers (name, contact_info) VALUES ('Rahim Traders',                '01711-000001');
INSERT INTO suppliers (name, contact_info) VALUES ('Dhaka Wholesale Ltd',          'info@dhakawholesale.example');
INSERT INTO suppliers (name, contact_info) VALUES ('Star Distributors',            '01911-000003');
INSERT INTO suppliers (name, contact_info) VALUES ('Chittagong Import House',      '031-2500001');
INSERT INTO suppliers (name, contact_info) VALUES ('Sylhet Tea & Goods',           '01755-100200');
INSERT INTO suppliers (name, contact_info) VALUES ('Khulna Bhandar',               '01711-700800');
COMMIT;
/

-- ----- Products -----
-- Reorder levels tuned so a few products end up LOW after the sales
-- below; see _seedcheck.js for the math.
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('USB Flash Drive 32GB', 'ELC-001', 1,  650.00,  NULL, 10, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Wireless Mouse',       'ELC-002', 1,  900.00,  NULL,  8, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Basmati Rice 5kg',     'GRC-001', 2,  780.00,  NULL, 15, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Notebook A4',          'STN-001', 3,  120.00,  NULL, 90, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Paracetamol 500mg',    'MED-001', 4,   30.00,  NULL, 50, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Printer Ink (exempt)', 'ELC-003', 1, 1500.00,  0.00,  5, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Walton 32" LED TV',          'ELC-004', 1, 18500.00, NULL,  6, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('A4 Tech Keyboard (Bengali)',  'ELC-005', 1,  1450.00, NULL, 15, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('ACI Pure Salt 1kg',          'GRC-002', 2,    45.00, NULL, 40, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Pran Mango Juice 1L',        'BEV-001', 5,   140.00, NULL, 30, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Dano Daily Milk Powder 1kg', 'BEV-002', 5,   720.00, NULL, 12, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Bashundhara Paper Napkins',  'GRC-003', 2,    85.00, NULL, 25, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Pran Toast Biscuit 200g',    'BKR-001', 6,    60.00, NULL, 40, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Olympic Bread Loaf 400g',    'BKR-002', 6,    70.00, NULL, 20, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Dettol Handwash 200ml',      'PRS-001', 7,   185.00, NULL, 18, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Sunsilk Shampoo 200ml',      'PRS-002', 7,   220.00, NULL, 15, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Classmate Pen (Pack of 10)', 'STN-002', 3,   150.00, NULL, 30, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('NCTB Math Textbook Class 8', 'BOK-001', 8,   120.00,  0.00, 25, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('HSC English Grammar Guide',  'BOK-002', 8,   350.00,  0.00, 10, 1);
INSERT INTO products (name, sku, category_id, unit_price, tax_rate_override, reorder_level, created_by) VALUES
 ('Seclo 20mg (Omeprazole)',    'MED-002', 4,     8.00, NULL, 80, 1);
COMMIT;
/

-- ----- Purchases + Sales (all in one PL/SQL block) -----
BEGIN
  app_ctx_pkg.set_role('admin');

  -- PUR-A
  INSERT INTO purchases (supplier_id, user_id, purchase_date)
    VALUES (4, 3, SYSTIMESTAMP - 12) RETURNING purchase_id INTO :pid_a;
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_a,  7,  8, 14500.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_a,  8, 20,  1100.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_a,  1, 50,   500.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_a,  2, 30,   700.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_a,  6,  6,  1200.00);

  -- PUR-B
  INSERT INTO purchases (supplier_id, user_id, purchase_date)
    VALUES (2, 3, SYSTIMESTAMP - 9) RETURNING purchase_id INTO :pid_b;
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_b,  3, 80,  650.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_b,  9,120,   35.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_b, 12, 60,   65.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_b, 13,100,   45.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_b, 14, 40,   55.00);

  -- PUR-C
  INSERT INTO purchases (supplier_id, user_id, purchase_date)
    VALUES (3, 7, SYSTIMESTAMP - 6) RETURNING purchase_id INTO :pid_c;
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_c, 10, 80,  110.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_c, 11, 30,  600.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_c,  4, 60,   80.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_c, 17, 60,  110.00);

  -- PUR-D
  INSERT INTO purchases (supplier_id, user_id, purchase_date)
    VALUES (5, 3, SYSTIMESTAMP - 3) RETURNING purchase_id INTO :pid_d;
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d, 15, 36,  140.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d, 16, 30,  170.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d, 18, 60,   90.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d, 19, 24,  260.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d,  5,150,   20.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_d, 20,200,    5.00);

  -- PUR-E
  INSERT INTO purchases (supplier_id, user_id, purchase_date)
    VALUES (6, 7, SYSTIMESTAMP - 1) RETURNING purchase_id INTO :pid_e;
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_e,  1, 30,  520.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_e,  9, 60,   36.00);
  INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (:pid_e, 14, 30,   56.00);

  -- 6 days ago
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (2, 'Karim Uddin (Mirpur)', SYSTIMESTAMP - 6) RETURNING sale_id INTO :sid_1;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_1,  1,  3);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_1,  3,  2);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_1,  6,  1);

  -- 5 days ago
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (2, 'Walk-in', SYSTIMESTAMP - 5) RETURNING sale_id INTO :sid_2;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_2,  4,  5);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_2,  5, 12);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_2, 17,  2);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (5, 'Rina Akter (Uttara)', SYSTIMESTAMP - 5) RETURNING sale_id INTO :sid_3;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_3, 15,  1);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_3, 16,  1);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_3, 13,  3);

  -- 4 days ago
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (2, 'Mirpur Govt Primary School', SYSTIMESTAMP - 4) RETURNING sale_id INTO :sid_4;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_4, 18, 25);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_4,  4, 25);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_4, 17,  5);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (4, 'BRAC Field Office (Mohammadpur)', SYSTIMESTAMP - 4) RETURNING sale_id INTO :sid_5;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_5,  5, 40);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_5, 20, 60);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_5, 15,  6);

  -- 3 days ago
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (5, 'Shahidul Alam (Dhanmondi)', SYSTIMESTAMP - 3) RETURNING sale_id INTO :sid_6;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_6,  7,  1);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_6,  8,  1);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (5, 'Walk-in', SYSTIMESTAMP - 3) RETURNING sale_id INTO :sid_7;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_7, 10,  4);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_7, 11,  2);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_7, 13,  2);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (5, 'Nazmul Haque (Old Dhaka)', SYSTIMESTAMP - 3) RETURNING sale_id INTO :sid_8;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_8,  3,  3);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_8,  9,  5);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_8, 12,  2);

  -- 2 days ago
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (4, 'Sadia Islam (Gulshan)', SYSTIMESTAMP - 2) RETURNING sale_id INTO :sid_9;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_9, 19,  2);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_9,  4,  3);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_9, 17,  1);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (4, 'Prime Bank Ltd (Motijheel)', SYSTIMESTAMP - 2) RETURNING sale_id INTO :sid_10;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_10,  1, 12);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_10,  2, 12);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_10,  8,  4);

  -- yesterday
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (2, 'Mahmud Hossain (Banani)', SYSTIMESTAMP - 1) RETURNING sale_id INTO :sid_11;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_11, 14,  4);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_11, 13,  6);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_11, 10,  3);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (4, 'Ayesha Begum (Mirpur-10)', SYSTIMESTAMP - 1) RETURNING sale_id INTO :sid_12;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_12, 11,  3);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_12, 16,  2);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_12,  9,  8);

  -- today
  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (2, 'Walk-in', SYSTIMESTAMP) RETURNING sale_id INTO :sid_13;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_13,  4,  2);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_13,  5,  4);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_13, 17,  1);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (4, 'Banglalink Customer Care (Gulshan-2)', SYSTIMESTAMP) RETURNING sale_id INTO :sid_14;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_14,  1,  5);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_14,  2,  5);

  INSERT INTO sales (user_id, customer_name, sale_date)
    VALUES (5, 'Mahfuz Rahman (Mohammadpur)', SYSTIMESTAMP) RETURNING sale_id INTO :sid_15;
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_15,  7,  1);
  INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (:sid_15,  6,  1);

  app_ctx_pkg.set_role(NULL);
END;
/

COMMIT;
/

-- Quick verification - shows you the final stock and which products
-- are at or below their reorder level.
SELECT name, sku, current_stock, reorder_level,
       CASE WHEN current_stock <= reorder_level THEN 'LOW' ELSE 'OK' END AS status
  FROM products
 ORDER BY status, name;
/
