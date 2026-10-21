// Recorded from a live Postgres 16 by dev/engine-e2e.ts --record. Do not edit.

export const PSQL: { vars: string[]; stdin: string; stdout: string }[] = [
  {
    "vars": [],
    "stdin": "select json_build_object(\n  'database', current_database(),",
    "stdout": "{\"database\" : \"shop\", \"user\" : \"postgres\", \"version\" : \"16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)\", \"schemas\" : [{\"name\":\"inventory\",\"relations\":[{\"name\" : \"batch_seq\", \"kind\" : \"sequence\", \"rows\" : null}, {\"name\" : \"product\", \"kind\" : \"table\", \"rows\" : null}],\"routines\":[]}, \n {\"name\":\"public\",\"relations\":[{\"name\" : \"settings\", \"kind\" : \"table\", \"rows\" : null}],\"routines\":[]}, \n {\"name\":\"sales\",\"relations\":[{\"name\" : \"big_orders\", \"kind\" : \"view\", \"rows\" : null}, {\"name\" : \"customer\", \"kind\" : \"table\", \"rows\" : 120}, {\"name\" : \"customer_id_seq\", \"kind\" : \"sequence\", \"rows\" : null}, {\"name\" : \"orders\", \"kind\" : \"table\", \"rows\" : 400}, {\"name\" : \"orders_id_seq\", \"kind\" : \"sequence\", \"rows\" : null}, {\"name\" : \"revenue_by_customer\", \"kind\" : \"matview\", \"rows\" : 120}],\"routines\":[{\"name\" : \"order_count\", \"args\" : \"c integer\", \"returns\" : \"bigint\", \"kind\" : \"function\"}]}]}\n"
  },
  {
    "vars": [
      "schema=sales",
      "name=orders"
    ],
    "stdin": "select coalesce(json_agg(json_build_object(\n  'name', a.att",
    "stdout": "[{\"name\" : \"id\", \"type\" : \"bigint\", \"notNull\" : true, \"default\" : \"nextval('sales.orders_id_seq'::regclass)\", \"isPrimaryKey\" : true, \"references\" : null}, {\"name\" : \"customer_id\", \"type\" : \"integer\", \"notNull\" : true, \"default\" : null, \"isPrimaryKey\" : false, \"references\" : \"customer.id\"}, {\"name\" : \"total\", \"type\" : \"numeric(10,2)\", \"notNull\" : true, \"default\" : null, \"isPrimaryKey\" : false, \"references\" : null}, {\"name\" : \"status\", \"type\" : \"text\", \"notNull\" : false, \"default\" : \"'new'::text\", \"isPrimaryKey\" : false, \"references\" : null}, {\"name\" : \"note\", \"type\" : \"text\", \"notNull\" : false, \"default\" : null, \"isPrimaryKey\" : false, \"references\" : null}]\n"
  },
  {
    "vars": [],
    "stdin": "select coalesce(json_agg(q.r), '[]'::json)\nfrom (select arr",
    "stdout": "[[\"1\",\"2\",\"7.30\",\"new\",\"note 1\"], \n [\"2\",\"3\",\"14.60\",\"new\",\"note 2\"], \n [\"3\",\"4\",\"21.90\",\"paid\",\"note 3\"], \n [\"4\",\"5\",\"29.20\",\"new\",\"note 4\"], \n [\"5\",\"6\",\"36.50\",\"new\",null], \n [\"6\",\"7\",\"43.80\",\"paid\",\"note 6\"], \n [\"7\",\"8\",\"51.10\",\"new\",\"note 7\"], \n [\"8\",\"9\",\"58.40\",\"new\",\"note 8\"], \n [\"9\",\"10\",\"65.70\",\"paid\",\"note 9\"], \n [\"10\",\"11\",\"73.00\",\"new\",null], \n [\"11\",\"12\",\"80.30\",\"new\",\"note 11\"], \n [\"12\",\"13\",\"87.60\",\"paid\",\"note 12\"], \n [\"13\",\"14\",\"94.90\",\"new\",\"note 13\"], \n [\"14\",\"15\",\"102.20\",\"new\",\"note 14\"], \n [\"15\",\"16\",\"109.50\",\"paid\",null], \n [\"16\",\"17\",\"116.80\",\"new\",\"note 16\"], \n [\"17\",\"18\",\"124.10\",\"new\",\"note 17\"], \n [\"18\",\"19\",\"131.40\",\"paid\",\"note 18\"], \n [\"19\",\"20\",\"138.70\",\"new\",\"note 19\"], \n [\"20\",\"21\",\"146.00\",\"new\",null], \n [\"21\",\"22\",\"153.30\",\"paid\",\"note 21\"], \n [\"22\",\"23\",\"160.60\",\"new\",\"note 22\"], \n [\"23\",\"24\",\"167.90\",\"new\",\"note 23\"], \n [\"24\",\"25\",\"175.20\",\"paid\",\"note 24\"], \n [\"25\",\"26\",\"182.50\",\"new\",null], \n [\"26\",\"27\",\"189.80\",\"new\",\"note 26\"], \n [\"27\",\"28\",\"197.10\",\"paid\",\"note 27\"], \n [\"28\",\"29\",\"204.40\",\"new\",\"note 28\"], \n [\"29\",\"30\",\"211.70\",\"new\",\"note 29\"], \n [\"30\",\"31\",\"219.00\",\"paid\",null], \n [\"31\",\"32\",\"226.30\",\"new\",\"note 31\"], \n [\"32\",\"33\",\"233.60\",\"new\",\"note 32\"], \n [\"33\",\"34\",\"240.90\",\"paid\",\"note 33\"], \n [\"34\",\"35\",\"248.20\",\"new\",\"note 34\"], \n [\"35\",\"36\",\"255.50\",\"new\",null], \n [\"36\",\"37\",\"262.80\",\"paid\",\"note 36\"], \n [\"37\",\"38\",\"270.10\",\"new\",\"note 37\"], \n [\"38\",\"39\",\"277.40\",\"new\",\"note 38\"], \n [\"39\",\"40\",\"284.70\",\"paid\",\"note 39\"], \n [\"40\",\"41\",\"292.00\",\"new\",null], \n [\"41\",\"42\",\"299.30\",\"new\",\"note 41\"], \n [\"42\",\"43\",\"306.60\",\"paid\",\"note 42\"], \n [\"43\",\"44\",\"313.90\",\"new\",\"note 43\"], \n [\"44\",\"45\",\"321.20\",\"new\",\"note 44\"], \n [\"45\",\"46\",\"328.50\",\"paid\",null], \n [\"46\",\"47\",\"335.80\",\"new\",\"note 46\"], \n [\"47\",\"48\",\"343.10\",\"new\",\"note 47\"], \n [\"48\",\"49\",\"350.40\",\"paid\",\"note 48\"], \n [\"49\",\"50\",\"357.70\",\"new\",\"note 49\"], \n [\"50\",\"51\",\"365.00\",\"new\",null]]\n"
  },
  {
    "vars": [],
    "stdin": "select coalesce(json_agg(q.r), '[]'::json)\nfrom (select arr",
    "stdout": "[[\"A-1\",\"{red,small}\",\"{\\\"w\\\": 1}\"], \n [\"B-2\",null,null], \n [\"C-3\",\"{}\",\"{\\\"nested\\\": {\\\"a\\\": [1, 2]}}\"]]\n"
  },
  {
    "vars": [
      "schema=sales",
      "name=orders"
    ],
    "stdin": "select to_json(\n  case\n    when c.relkind in ('v', 'm') the",
    "stdout": "\"create table sales.orders (\\n  id bigint default nextval('sales.orders_id_seq'::regclass) not null,\\n  customer_id integer not null,\\n  total numeric(10,2) not null,\\n  status text default 'new'::text,\\n  note text,\\n  constraint orders_pkey PRIMARY KEY (id),\\n  constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES sales.customer(id)\\n);\"\n"
  }
]
