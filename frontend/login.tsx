import { A, redirect, useNavigate } from "@solidjs/router"

// 选择要连接的数据库 选项有 postgres redis
export default function ChooseDatabase() {

    return (
        <A href="/postgres">postgres</A>
    )
}