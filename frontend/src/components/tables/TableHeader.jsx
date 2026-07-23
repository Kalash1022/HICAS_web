export default function TableHeader({ columns }) {
  return (
    <div className="table-row table-head" role="row">
      {columns.map((column) => <div role="columnheader" key={column}>{column}</div>)}
    </div>
  );
}
