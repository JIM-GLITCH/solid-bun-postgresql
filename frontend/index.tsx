import { render } from 'solid-js/web';

import App from './app';
import { Route, HashRouter } from '@solidjs/router';
import Postgres from './postgres';
import QueryInterface from './query-interface';

const root = document.getElementById('root');


render(() => (<HashRouter>
    <Route path="/" component={App} />
    <Route path="/postgres" component={Postgres} />
    <Route path="/postgres/query-interface" component={QueryInterface} />
</HashRouter>), root!);
