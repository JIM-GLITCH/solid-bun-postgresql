
import ChooseDatabase from './login';
export default function App() {
  const columnNames = [
    { key: 'name', label: '姓名' },
    { key: 'age', label: '年龄' },
    { key: 'role', label: '角色' },
  ];

  const datas = [
    { name: 'Alice', age: 28, role: 'Designer' },
    { name: 'Bob', age: 34, role: 'Engineer' },
    { name: 'Carol', age: 31, role: 'Product' },
  ];

  return (
    <main>
      <ChooseDatabase></ChooseDatabase>
    </main>
  );
}