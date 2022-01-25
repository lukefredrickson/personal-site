import * as React from "react"
import { graphql, Link } from "gatsby"
import Layout from "../../components/layout.js"

function Blog({ data }) {
    const post = data.markdownRemark.frontmatter

    return (
        <Layout>
            <div className="wrapper">
                <header>
                    <Link to="/">Go back to "Home"</Link>
                </header>
                <main>
                    {console.log(post)}
                </main>
            </div>
        </Layout>
    )
}

export default Blog

export const query = graphql`
    query BlogPostQuery {
      markdownRemark {
        frontmatter {
          title
          description
          date(formatString: "MM-DD-YYYY")
          thumbnail
        }
      }
    }
`