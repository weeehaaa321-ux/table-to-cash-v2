// Generic typed identifier so we can't accidentally pass an OrderId where
// a TableId is expected. Cuid string at runtime; phantom type at compile time.

export type Identifier<Brand extends string> = string & { readonly __brand: Brand };

export function makeId<Brand extends string>(raw: string): Identifier<Brand> {
  return raw as Identifier<Brand>;
}
