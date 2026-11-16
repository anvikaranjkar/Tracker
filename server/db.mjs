let client;
export async function productionDb() {
  if (!process.env.DATABASE_URL) return null;
  const { default: postgres } = await import('postgres');
  client ??= postgres(process.env.DATABASE_URL, {
    max: 2,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 15,
    max_lifetime: 300
  });
  const wrap = sql => ({
    async query(statement, parameters = []) {
      return { rows: await sql.unsafe(statement, parameters) };
    }
  });
  return {
    ...wrap(client),
    transaction: work => client.begin(sql => work(wrap(sql))),
    close: () => client.end({ timeout: 2 })
  };
}
